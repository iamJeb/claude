// Replays real replies from ordinary coding sessions under the plugin: each sampled reply is
// rewritten by Claude with the plugin's guide, told to keep every fact and add nothing, and then
// measured. Short replies (under MIN_WORDS) need no stretches by the guide's own rule and are
// counted as they are, without a model call.
//   npm run bench:replay -- [--per-project 20] [--words 150] [--out bench/out/replay.jsonl] <~/.claude/projects/<dir>>...
// Needs a signed-in `claude`. Raw text stays in bench/out/, which git ignores.
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DEFAULT_SHORT_WORDS, guide, wordsOf } from '../hooks/guide.ts'
import { claudeArgs, claudeCommand, resultOf, REWRITE } from './grading.ts'
import { measure, recall, render, words } from './measure.ts'
import { expand, transcriptsIn, turnsOf } from './transcripts.ts'

const run = promisify(execFile)
const MIN_WORDS = 40
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : (args.splice(at, 2)[1] ?? fallback)
}
const perProject = Number(option('--per-project', '20'))
const seed = Number(option('--seed', '7'))
const concurrency = Number(option('--concurrency', '3'))
const shortWords = wordsOf(option('--words', String(DEFAULT_SHORT_WORDS)))
const out = option('--out', fileURLToPath(new URL('./out/replay.jsonl', import.meta.url)))
const dirs = args
if (shortWords === undefined) {
  console.error('--words wants a whole number from 10 to 2000')
  process.exit(1)
}
if (dirs.length === 0) {
  console.error('replay wants project folders to sample, as ~/.claude/projects/<dir>')
  process.exit(1)
}
const GUIDE = guide(shortWords)

/** A small seeded generator, so the same transcripts always give the same sample. */
function random(state: number) {
  return () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

async function rewrite(reply: string): Promise<string> {
  const { command, lead } = claudeCommand()
  const { stdout } = await run(command, [...lead, ...claudeArgs('opus', REWRITE(reply), { system: GUIDE })], { maxBuffer: 1 << 26, timeout: 300000 })
  return resultOf(stdout).text
}

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, '')
const jobs: (() => Promise<void>)[] = []
for (const dir of dirs) {
  const folder = expand(dir)
  const project = basename(folder)
  const turns = transcriptsIn([folder]).flatMap(file => turnsOf(file).map(turn => ({ ...turn, file }))).filter(t => words(t.reply) > 0)
  // A seeded Fisher-Yates shuffle: every reply is equally likely to be sampled.
  const pick = random(seed)
  const shuffled = [...turns]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1))
    const a = shuffled[i], b = shuffled[j]
    if (a !== undefined && b !== undefined) {
      shuffled[i] = b
      shuffled[j] = a
    }
  }
  const sample = shuffled.slice(0, perProject)
  for (const turn of sample) {
    jobs.push(async () => {
      const original = words(turn.reply)
      const row = { source: 'replay', project, session: turn.session, turn: turn.index, file: turn.file, original }
      if (original < MIN_WORDS) {
        appendFileSync(out, `${JSON.stringify({ ...row, skim: original, full: original, rewritten: false, recall: 1 })}\n`)
        return
      }
      try {
        const text = await rewrite(turn.reply)
        const m = measure(text)
        appendFileSync(out, `${JSON.stringify({ ...row, ...m, rewritten: true, recall: recall(turn.reply, render(text, 'all')), text })}\n`)
      } catch (error) {
        console.error(`skipped ${project} ${turn.session} #${turn.index}: ${(error as Error).message.split('\n')[0]}`)
      }
    })
  }
}

let next = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  for (let job = jobs[next++]; job !== undefined; job = jobs[next++]) await job()
}))
console.error(`${jobs.length} replies sampled, measured into ${out}`)
