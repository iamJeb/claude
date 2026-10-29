// Measures replies written with the plugin on, and what the reader actually opened.
//   npm run bench:native -- [--out bench/out/native.jsonl] <transcript.jsonl or ~/.claude/projects/<dir>>...
// A reply counts when the plugin's guide was in force when it was written, with or without a
// stretch in it. The rows hold counts only: no reply text.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { measure } from './measure.ts'
import { transcriptsIn, turnsOf } from './transcripts.ts'

const args = process.argv.slice(2)
const at = args.indexOf('--out')
const out = at === -1 ? fileURLToPath(new URL('./out/native.jsonl', import.meta.url)) : (args.splice(at, 2)[1] ?? '')
if (args.length === 0) {
  console.error('native wants transcript files or project folders, as ~/.claude/projects/<dir>')
  process.exit(1)
}

const rows: string[] = []
let guided = 0
for (const path of transcriptsIn(args)) {
  for (const turn of turnsOf(path)) {
    if (!turn.isGuided) continue
    guided += 1
    const m = measure(turn.reply, turn.opened)
    const hasStretch = m.skim !== m.full || /\{\{[^{}|\s][^{}|]*\|/.test(turn.reply)
    rows.push(JSON.stringify({ source: 'native', session: turn.session, turn: turn.index, ...m, hasStretch, hasNote: turn.opened !== undefined, opened: turn.opened ? [...turn.opened] : undefined }))
  }
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, rows.map(row => `${row}\n`).join(''))
console.error(`${guided} replies written under the guide, measured into ${out}`)
