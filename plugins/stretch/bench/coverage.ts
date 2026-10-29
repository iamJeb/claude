// Does the skim still carry the answer? For a sample of replayed replies, a blind reader sees
// only one version of a reply (the skim, or the original as a control) and writes down what it
// was told; a grader then lists the original's must-know points and checks the reader's notes
// against them. Same pipeline for both versions, so the control shows how strict the grader is.
//   npm run bench:coverage -- [--per-project 4] [--out bench/out/coverage.jsonl]
import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { claudeArgs, claudeCommand, resultOf } from './grading.ts'
import { render } from './measure.ts'
import { turnsOf } from './transcripts.ts'

const run = promisify(execFile)
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : (args.splice(at, 2)[1] ?? fallback)
}
const perProject = Number(option('--per-project', '4'))
const out = option('--out', fileURLToPath(new URL('./out/coverage.jsonl', import.meta.url)))

type Replayed = { project: string; session: string; turn: number; file: string; rewritten: boolean; text?: string }
const replayed = readFileSync(fileURLToPath(new URL('./out/replay.jsonl', import.meta.url)), 'utf8').split('\n').filter(Boolean)
  .map(line => JSON.parse(line) as Replayed).filter(r => r.rewritten && r.text !== undefined)

async function ask(prompt: string): Promise<string> {
  const { command, lead } = claudeCommand()
  const { stdout } = await run(command, [...lead, ...claudeArgs('opus', prompt, {})], { maxBuffer: 1 << 26, timeout: 300000 })
  return resultOf(stdout).text
}

const READ = (text: string) =>
  `You are reading a reply from a coding assistant in a terminal, and this is all you can see of it. Write down, as a short numbered list, every decision you are asked to make, every action you are told to take, and every result you are told about. Output only the list.\n\n<reply>\n${text}\n</reply>`

const GRADE = (original: string, first: string, second: string) =>
  `Below is a reply from a coding assistant, and the notes of two readers who each saw some version of it. First list the original's must-know points: decisions the reader must make, actions they must take, results they must know. At most eight, the most important first. Then judge, for each point and each reader, whether that reader's notes capture it: "yes", "partly" or "no". Answer only with JSON of the form {"points":[{"point":"...","reader1":"yes","reader2":"no"}]}.\n\n<original>\n${original}\n</original>\n\n<reader1-notes>\n${first}\n</reader1-notes>\n\n<reader2-notes>\n${second}\n</reader2-notes>`

type Verdicts = { point?: string; reader1?: string; reader2?: string }[]
/** One reader's verdicts, most important point first, and their totals. */
function tally(points: Verdicts, reader: 'reader1' | 'reader2') {
  const verdicts = points.map(p => p[reader] ?? 'no')
  return { points: points.length, yes: verdicts.filter(v => v === 'yes').length, partly: verdicts.filter(v => v === 'partly').length, verdicts }
}

const byProject = new Map<string, Replayed[]>()
for (const r of replayed) byProject.set(r.project, [...(byProject.get(r.project) ?? []), r])
const sample = [...byProject.values()].flatMap(rows => rows.slice(0, perProject))

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, '')
let next = 0
await Promise.all(Array.from({ length: 3 }, async () => {
  for (let r = sample[next++]; r !== undefined; r = sample[next++]) {
    const turn = turnsOf(r.file).find(t => t.index === r.turn)
    if (turn === undefined || r.text === undefined) continue
    try {
      const skimNotes = await ask(READ(render(r.text, new Set())))
      const originalNotes = await ask(READ(turn.reply))
      // The grader sees both readers under neutral labels, in an order that alternates by reply.
      const skimFirst = r.turn % 2 === 0
      const answer = await ask(GRADE(turn.reply, skimFirst ? skimNotes : originalNotes, skimFirst ? originalNotes : skimNotes))
      const points = (JSON.parse(/\{[\s\S]*\}/.exec(answer)?.[0] ?? '{}') as { points?: Verdicts }).points ?? []
      const row = { project: r.project, session: r.session, turn: r.turn }
      appendFileSync(out, `${JSON.stringify({ ...row, version: 'skim', ...tally(points, skimFirst ? 'reader1' : 'reader2') })}\n`)
      appendFileSync(out, `${JSON.stringify({ ...row, version: 'original', ...tally(points, skimFirst ? 'reader2' : 'reader1') })}\n`)
    } catch (error) {
      console.error(`skipped ${r.session} #${r.turn}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
}))
console.error(`${sample.length} replies graded into ${out}`)
