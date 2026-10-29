// Turns bench/out/*.jsonl into bench/out/results.md and results.csv: aggregate numbers only, no
// reply text. Both land beside the measurements, which git ignores, so the repository never
// carries a number that another machine cannot reproduce.
//   npm run bench:report
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Row = { source: 'native' | 'replay'; project?: string; session?: string; turn?: number; original?: number; skim: number; full: number; read?: number; rewritten?: boolean; recall?: number; hasStretch?: boolean }
type Graded = { project: string; version: 'skim' | 'original'; points: number; yes: number; partly: number; verdicts?: string[] }

const OUT = fileURLToPath(new URL('./out/', import.meta.url))
const rows: Row[] = (existsSync(OUT) ? readdirSync(OUT) : [])
  .filter(f => f === 'native.jsonl' || f === 'replay.jsonl')
  .flatMap(f => readFileSync(join(OUT, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Row))

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (i: number) => s[i] ?? NaN
  return s.length === 0 ? NaN : s.length % 2 ? at((s.length - 1) / 2) : (at(s.length / 2 - 1) + at(s.length / 2)) / 2
}
const pct = (x: number) => `${Math.round(x * 100)}%`
// The report names projects by letter, in the order they first appear; real names stay in the rows.
const letters = new Map<string, string>()
const projectName = (dir = '') => {
  if (!letters.has(dir)) letters.set(dir, `project ${String.fromCharCode(65 + letters.size)}`)
  return letters.get(dir) ?? dir
}

const replay = rows.filter(r => r.source === 'replay')
const native = rows.filter(r => r.source === 'native')
const rewritten = replay.filter(r => r.rewritten)
const stretched = native.filter(r => r.hasStretch !== false)
const noted = native.filter(r => r.read !== undefined)
if (replay.length + native.length === 0) {
  console.error('No measurements in bench/out/. Write some with bench/native.ts or bench/replay.ts first; bench/README.md has the commands.')
  process.exit(1)
}

const lines: string[] = ['# Stretch benchmark results', '']
lines.push('Written by `npm run bench:report`. skim: a reply with every stretch closed. full: every stretch open. read: only the stretches the reader opened.', '')
if (replay.length > 0) {
  const projects = [...new Set(replay.map(r => r.project))]
  lines.push('## Replay: real replies, rewritten under the guide', '')
  lines.push('The comparison is with the reply as it was first written: what you would have read without the plugin.', '')
  lines.push('| project | replies | rewritten | original words | skim words | skim / original | median per reply | full / original |', '|---|---|---|---|---|---|---|---|')
  for (const p of [...projects, undefined]) {
    const set = p === undefined ? replay : replay.filter(r => r.project === p)
    const original = sum(set.map(r => r.original ?? r.full))
    lines.push(`| ${p === undefined ? 'all' : projectName(p)} | ${set.length} | ${set.filter(r => r.rewritten).length} | ${original} | ${sum(set.map(r => r.skim))} | ${pct(sum(set.map(r => r.skim)) / original)} | ${pct(median(set.map(r => r.skim / (r.original ?? r.full))))} | ${pct(sum(set.map(r => r.full)) / original)} |`)
  }
  lines.push('')
  if (rewritten.length > 0) lines.push(`Fidelity of the ${rewritten.length} rewrites: with every stretch open, the text kept a mean ${pct(sum(rewritten.map(r => r.recall ?? 0)) / rewritten.length)} of the original's content words (lowest ${pct(Math.min(...rewritten.map(r => r.recall ?? 0)))}). Replies under 40 words need no stretches by the guide's own rule and were counted as written.`, '')
}
const graded: Graded[] = (() => {
  try {
    return readFileSync(join(OUT, 'coverage.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Graded)
  } catch {
    return []
  }
})()
if (graded.length > 0) {
  const replies = graded.length / 2
  lines.push('## Coverage: does the skim still carry the answer?', '')
  lines.push(`For ${replies} of the replayed replies, a blind reader saw only one version and noted every decision, action and result it was told about. A grader listed the original's must-know points (at most eight) and checked both readers' notes against the same list, with the two readers under neutral labels in alternating order. The original is the control: it shows how strict the grader is.`, '')
  const credit = (v: string) => (v === 'yes' ? 1 : v === 'partly' ? 0.5 : 0)
  lines.push('| reader saw | must-know points | caught | partly | missed | coverage, all points | coverage, top three |', '|---|---|---|---|---|---|---|')
  for (const version of ['skim', 'original'] as const) {
    const set = graded.filter(g => g.version === version)
    const points = sum(set.map(g => g.points)), yes = sum(set.map(g => g.yes)), partly = sum(set.map(g => g.partly))
    const top = set.flatMap(g => (g.verdicts ?? []).slice(0, 3))
    lines.push(`| ${version} | ${points} | ${yes} | ${partly} | ${points - yes - partly} | ${pct((yes + partly / 2) / points)} | ${pct(sum(top.map(credit)) / top.length)} |`)
  }
  lines.push('', 'Coverage counts a caught point as 1 and a partly caught one as 0.5. The grader lists points most important first; "top three" scores only those.', '')
}

if (native.length > 0) {
  lines.push('## Native: replies written with the plugin on, and what the reader opened', '')
  lines.push(`${native.length} replies written under the guide, ${stretched.length} with a stretch: skim ${sum(stretched.map(r => r.skim))} of ${sum(stretched.map(r => r.full))} full words (${pct(sum(stretched.map(r => r.skim)) / sum(stretched.map(r => r.full)))}).`)
  if (noted.length > 0) lines.push(`${noted.length} of them came with a reading note: the reader read ${sum(noted.map(r => r.read ?? 0))} of ${sum(noted.map(r => r.full))} words (${pct(sum(noted.map(r => r.read ?? 0)) / sum(noted.map(r => r.full)))}).`)
  lines.push('')
}
writeFileSync(join(OUT, 'results.md'), `${lines.join('\n')}\n`)
// One row per replayed reply, counts only, so anyone can recompute the table above.
const csv = ['project,session,reply,original_words,skim_words,full_words,content_recall',
  ...replay.map(r => [projectName(r.project), (r.session ?? '').slice(0, 8), r.turn, r.original ?? r.full, r.skim, r.full, (r.recall ?? 1).toFixed(3)].join(','))]
writeFileSync(join(OUT, 'results.csv'), `${csv.join('\n')}\n`)
console.log(lines.join('\n'))
