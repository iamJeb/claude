import { describe, expect, test } from 'claude-code/testing'

import { ADDED, VARIANTS } from '../bench/guides.ts'
import { readChecks, readKey, readLabels, readPoints, resultOf } from '../bench/grading.ts'
import { growthOf } from '../bench/growth.ts'
import { differences, readManifest, rowsOf } from '../bench/manifest.ts'
import type { Manifest } from '../bench/manifest.ts'
import { measure, openedFrom, render, words } from '../bench/measure.ts'
import { adjudicate, hiddenIn, verdictsOf } from '../bench/rules.ts'
import type { RuleId } from '../bench/rules.ts'
import { readTask, TASKS } from '../bench/tasks.ts'
import type { Layout } from '../bench/tasks.ts'
import { DEFAULT_SHORT_WORDS, guide } from '../hooks/guide.ts'
import { parse } from '../hooks/parse.ts'

const GUIDE = guide(DEFAULT_SHORT_WORDS)
const REPLY = 'The build {{fails|fails on {{a stale cache|a cache keyed only by the lockfile}}}}. Fix `{{x|y}}` first.'

describe('benchmark measures', () => {
  test('skim closes every stretch, full opens every one, read opens only what the reader opened', async () => {
    expect(render(REPLY, new Set())).toBe('The build fails. Fix `{{x|y}}` first.')
    expect(render(REPLY, 'all')).toBe('The build fails on a cache keyed only by the lockfile. Fix `{{x|y}}` first.')
    expect(render(REPLY, new Set(['fails']))).toBe('The build fails on a stale cache. Fix `{{x|y}}` first.')
    expect(measure(REPLY, new Set(['fails']))).toEqual({ skim: 6, full: 14, read: 10 })
  })

  test('draws a short form over two lines open, and leaves an empty long form or an unclosed stretch as text', async () => {
    expect(render('A {{b\nc|d e}} f', new Set())).toBe('A d e f')
    expect(render('A {{b\nc|}} f', new Set())).toBe('A b\nc f')
    expect(render('A {{b|c d', new Set())).toBe('A {{b|c d')
    expect(render('A {{b|c d', 'all')).toBe('A {{b|c d')
  })

  test('a stretch closing on a code block\'s closing fence leaves the text after it in both measures', async () => {
    const text = ['{{Count the rows before pushing.|Count the rows before pushing, then push:', '```bash', 'git push', '```}}', '', '{{Risks remain in the export.|Risks remain in the export, long.}}', '', 'Bottom line: done.'].join('\n')
    expect(render(text, new Set())).toBe('Count the rows before pushing.\n\nRisks remain in the export.\n\nBottom line: done.')
    expect(render(text, 'all')).toBe('Count the rows before pushing, then push:\n```bash\ngit push\n```\n\nRisks remain in the export, long.\n\nBottom line: done.')
    expect(measure(text)).toEqual({ skim: 13, full: 19 })
  })

  test('counts where the added words land around the short form', async () => {
    expect(growthOf('The build fails on a stale cache.', parse('The CI build fails, about one run in five, on a stale dependency cache keyed only by package.json.'))).toEqual({ before: 0, between: 7, after: 4, missing: 0 })
    expect(growthOf('Two options exist.', parse('Two options exist. One is a command, the other a hover.'))).toEqual({ before: 0, between: 0, after: 8, missing: 0 })
    expect(growthOf('Three options exist.', parse('Two options exist.')).missing).toBe(1)
  })

  test('counts words that hold a letter or a digit, not markup or punctuation', async () => {
    expect(words('A *b* -- `c` 42 ---')).toBe(4)
  })

  test('reads the opened stretches back from the reading note the plugin writes', async () => {
    expect([...openedFrom('Stretch: in your last reply the reader opened "a b", "c". They did not open "d".')]).toEqual(['a b', 'c'])
    expect([...openedFrom('Stretch: in your last reply the reader opened "a b".')]).toEqual(['a b'])
    expect(openedFrom('Stretch: in your last reply the reader opened none of "a b", "c". They may have read only the short forms; where clicks cannot land (a terminal not in fullscreen, VS Code, the phone app) every stretch was drawn open.').size).toBe(0)
  })

  test('tells a long form that holds sections or the status block from one that holds neither', async () => {
    const status = 'Status: built, not pushed.\n\n---\n\n**MISSION** · x, y\n\n- [x] Built the thing\n- [ ] Push it\n- [ ] Tag it'
    expect(hiddenIn(status)).toBe('status block')
    expect(hiddenIn('---\n\n- [x] Fixed it\n- [x] Pushed it\n\n**Later** · Rebuild\n\n---')).toBe('status block')
    expect(hiddenIn('Two parts:\n\n**One.** A.\n\n---\n\n**Two.** B.')).toBe('sections')
    expect(hiddenIn('---\n\n**One.** A.\n\n**Two.** B.\n\n---')).toBe('status block')
    expect(hiddenIn('Why it turned it down:\n\n- **One.** A.\n- **Two.** B.')).toBe('sections')
    expect(hiddenIn('\n\n**What the lens found.** A gap.\n\n**What I did.** Closed it.')).toBe('sections')
    expect(hiddenIn('Three steps:\n1. a\n2. b\n3. c')).toBe('sections')
    expect(hiddenIn('Three steps:\n+ a\n+ b\n1) c')).toBe('sections')
    expect(hiddenIn('Two steps:\n1. a\n2. b')).toBe(undefined)
    expect(hiddenIn('The cache is keyed by **the lockfile** and **the platform**.')).toBe(undefined)
  })
})

describe('layout rules', () => {
  const ITEMS = [['memory'], ['sqlite'], ['redis']]
  /** Whether `rule` holds for `text` under `task`; a rule that does not apply is a test error. */
  const holds = (rule: RuleId, text: string, task: Layout = {}) => {
    const verdict = verdictsOf(text, task).find(v => v.rule === rule)
    if (verdict === undefined) throw new Error(`${rule} does not apply`)
    return verdict.holds
  }
  const cases = (rule: RuleId, task: Layout, fail: string[], pass: string[]) => {
    for (const text of fail) expect([text, holds(rule, text, task)]).toEqual([text, false])
    for (const text of pass) expect([text, holds(rule, text, task)]).toEqual([text, true])
  }

  test('keeps-short-words: the long form keeps the short form\'s words in order', async () => {
    cases('keeps-short-words', {}, ['Short: {{The build fails.|CI is broken by a stale cache.}}', 'It {{fails on a cache|on a cache it fails}}.'], [
      '{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by `package.json`.}}',
      '{{The fix is one line.|The fix is one line: add the lockfile to the key.}}',
    ])
  })

  test('short-form-inline: the short form is one plain line', async () => {
    cases('short-form-inline', {}, ['A {{first line\nsecond line|both lines, opened}} b.', '{{- Memory is only temporary.|- Memory is only temporary and resets on restart.}}', 'See {{## Setup|## Setup, step by step}}'], [
      'Run {{`npm test` first|`npm test` first, then the build}}.',
    ])
  })

  test('short-form-has-words: a link is words, never punctuation alone', async () => {
    cases('short-form-has-words', {}, ['It merged 3 days ago{{.|, and its e2e run passed.}}', 'Three approaches{{:|, each with its tradeoffs:}}'], [
      'It {{merged|merged 3 days ago}}.',
      '{{已合并。|三天前已合并。}}',
      'Run {{`npm test` first|`npm test` first, then the build}}.',
    ])
  })

  test('adds-words: a stretch opens to something new', async () => {
    cases('adds-words', {}, ['- {{Memory is only temporary.|Memory is only temporary.}}', 'A {{b c|b c}} d.'], ['- {{Memory is only temporary.|Memory is only temporary, and resets on restart.}}'])
  })

  test('not-in-heading-or-table: no stretch in a heading or a table row', async () => {
    cases('not-in-heading-or-table', {}, ['## Setup {{takes a minute|takes about a minute}}\n\nText.', '| tool | note |\n|---|---|\n| node | {{runs it|runs the bench}} |'], [
      'Use a {{pipe|pipe, the `|` character,}} between columns.',
      'Write `{{a|b}}` to make a stretch.',
      '{{Setup takes a minute.|## Setup\n\nSetup takes a minute.}}',
    ])
  })

  test('no-stretch-in-short-reply: a short answer has no stretch', async () => {
    cases('no-stretch-in-short-reply', { needsNoStretch: true }, ['{{Use git log for it.|Use git log --oneline -5 for it.}}'], ['git log --oneline -5', 'CSV, JSON, Parquet'])
  })

  test('items-stay-visible: each list item stays in view with a stretch of its own', async () => {
    const own = (name: string) => `{{${name} is one option.|${name} is one option, with its tradeoff.}}`
    cases('items-stay-visible', { items: ITEMS }, [
      '{{Three options are open here.|- Memory is temporary.\n- SQLite persists.\n- Redis is shared.}}',
      `- ${own('Memory')}\n- ${own('SQLite')}\n{{One more is open here.|- Redis is shared.}}`,
      '- Memory is temporary.\n- SQLite persists.\n- Redis is shared.',
      '- {{Memory is only temporary.|Memory is only temporary.}}\n- {{SQLite persists on disk.|SQLite persists on disk.}}\n- {{Redis is shared widely.|Redis is shared widely.}}',
      '{{Memory, SQLite and Redis all work.|Memory is fast, SQLite persists, Redis is shared.}}',
      '{{Memory and SQLite both keep little.|Memory and SQLite both keep little across restarts.}} {{Redis is shared.|Redis is shared across replicas.}} {{Restarts lose data.|Restarts lose data in memory.}}',
    ], [
      `- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `${own('Memory')} It is the one to pick.\n\n- ${own('SQLite')}\n- ${own('Redis')}`,
      `1. ${own('Memory')}\n2. ${own('SQLite')}\n* ${own('Redis')}`,
      `Three options, memory, SQLite and Redis:\n\n- ${own('Memory')}\n- ${own('SQLite')}\n- ${own('Redis')}`,
    ])
  })

  test('closing-block-last: a required closing block is the last stretch', async () => {
    const block = '---\nDone: the parser.\nNext: the export.\n---'
    const status = '{{Status: parser done, export next.|Done: the parser.\nNext: the export.}}'
    cases('closing-block-last', { closing: 'End with a status block.' }, [
      `The parser is merged.\n\n${block}`,
      `The parser is merged.\n\n{{Status: parser done, export next.|\n${block}}}\n\nThat is all.`,
      `The parser is merged.\n\n---\n${status}`,
      `The parser is merged.\n\n${status}\n---`,
      `The parser is merged.\n\n---\n${status}\n---\nThat is all.`,
    ], [
      `The parser is merged.\n\n{{Status: parser done, export next.|\n${block}}}`,
      `The parser is merged.\n\n---\n${status}\n---`,
    ])
  })

  test('a rule a task does not ask for is not checked', async () => {
    expect(verdictsOf('git log', {}).map(v => v.rule)).toEqual(['keeps-short-words', 'short-form-inline', 'short-form-has-words', 'adds-words', 'not-in-heading-or-table'])
  })
})

describe('run manifests and judge answers', () => {
  const MANIFEST: Manifest = {
    command: 'tasks', repeats: 1, writer: 'opus', judge: 'haiku', effort: 'default',
    arms: { a: 'aaa', b: 'bbb' }, tasks: TASKS.slice(0, 2), claude: '2.1.312 (Claude Code)', code: 'c-1', revision: { commit: 'c1', isDirty: false },
  }

  test('a manifest differs from another only where an input changed, never by its revision', async () => {
    expect(differences(MANIFEST, { ...MANIFEST, revision: { commit: 'c2', isDirty: true } })).toEqual([])
    expect(differences(MANIFEST, { ...MANIFEST, arms: { a: 'aaa', b: 'changed' }, judge: 'sonnet', claude: '2.1.313 (Claude Code)', code: 'c-2' })).toEqual(['arms.b', 'claude', 'code', 'judge'])
    const [first, second] = TASKS
    if (first === undefined || second === undefined) throw new Error('needs two tasks')
    expect(differences(MANIFEST, { ...MANIFEST, tasks: [{ ...first, key: { ...first.key, never: ['a new claim'] } }, second] })).toEqual([`tasks.${first.id}`])
    expect(differences(MANIFEST, { ...MANIFEST, repeats: 2 })).toEqual(['repeats'])
    // A task read back from disk may hold its fields in another order, which is no difference.
    expect(differences(MANIFEST, readManifest(JSON.stringify(MANIFEST, (_, v: unknown) => (typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v))))).toEqual([])
  })

  test('a manifest and its tasks read back whole, and a malformed one is refused', async () => {
    expect(readManifest(JSON.stringify(MANIFEST))).toEqual(MANIFEST)
    for (const task of TASKS) expect(readTask(JSON.parse(JSON.stringify(task)))).toEqual(task)
    expect(() => readManifest('{"command":"tasks"}')).toThrow('not a guide bench manifest')
    expect(() => readManifest(JSON.stringify({ ...MANIFEST, tasks: undefined }))).toThrow('holds no tasks')
    expect(() => readTask({ id: 'x', question: 'q', evidence: 'e', key: { know: [], defer: [], never: [1] } })).toThrow()
  })

  test('a judge answer is read strictly: wrong words or counts throw', async () => {
    expect(readKey('```json\n{"know":["yes","partly"],"never":["no"]}\n```', 2, 1)).toEqual({ know: ['yes', 'partly'], never: ['no'] })
    expect(() => readKey('{"know":["yes","maybe"],"never":["no"]}', 2, 1)).toThrow('"maybe"')
    expect(() => readKey('{"know":["yes"],"never":["no"]}', 2, 1)).toThrow('not 2')
    expect(() => readKey('{"know":["yes","no","no"],"never":["no"]}', 2, 1)).toThrow('not 2')
    expect(() => readKey('{"know":["yes","no"],"never":["partly"]}', 2, 1)).toThrow('"partly"')
    expect(readLabels('{"verdicts":{"1":"gist","2":"label"}}', 2)).toEqual(['gist', 'label'])
    expect(() => readLabels('{"verdicts":{"1":"gist"}}', 2)).toThrow('exactly 2')
    expect(() => readLabels('{"verdicts":{"1":"gist","3":"label"}}', 2)).toThrow('phrase 2')
    expect(() => readPoints('{"points":[]}')).toThrow()
    expect(() => readChecks('no json here', 1)).toThrow('no JSON object')
  })

  test('the answer of a print run is read with the models that wrote it', async () => {
    const events = (result: object) => JSON.stringify([{ type: 'system', model: 'claude-opus-5-5' }, { type: 'result', ...result }])
    expect(resultOf(events({ is_error: false, result: ' hi ', modelUsage: { 'claude-opus-5-5': {}, 'claude-haiku-5-5': {} } }))).toEqual({ text: 'hi', models: ['claude-haiku-5-5', 'claude-opus-5-5'] })
    expect(() => resultOf(events({ is_error: true, result: 'API Error: overloaded\nmore' }))).toThrow('API Error: overloaded')
    expect(() => resultOf(JSON.stringify([{ type: 'result', is_error: false, result: 'hi' }]))).toThrow('named no model')
  })

  test('a run file skips a last line cut short, and refuses a malformed one elsewhere', async () => {
    expect(rowsOf('{"a":1}\n{"a":2}\n{"a":')).toEqual({ rows: [{ a: 1 }, { a: 2 }], isCut: true })
    expect(rowsOf('{"a":1}\n')).toEqual({ rows: [{ a: 1 }], isCut: false })
    expect(() => rowsOf('{"a":1}\n{"a":\n{"a":3}\n')).toThrow('line 2')
  })
})

describe('tasks and guide variants', () => {
  test('every task is well formed: unique ids, items named by words, short tasks without items', async () => {
    expect(new Set(TASKS.map(t => t.id)).size).toBe(TASKS.length)
    for (const task of TASKS) {
      expect([task.id, task.needsNoStretch === true && (task.items?.length ?? 0) > 0]).toEqual([task.id, false])
      for (const item of task.items ?? []) expect([task.id, item.length > 0 && item.every(word => word.trim() !== '')]).toEqual([task.id, true])
      expect([task.id, task.key.know.length > 0]).toEqual([task.id, true])
    }
    expect(TASKS.filter(t => t.heldOut === true).map(t => t.id)).toEqual(['rollout-evidence', 'search-options-zh', 'auth-options', 'parser-status'])
  })

  test('g0 is the plugin guide, and additive variants only add their declared sentences', async () => {
    expect(VARIANTS.g0).toBe(GUIDE)
    expect(GUIDE).toContain(' Stretch list items, not whole lists.')
    for (const [name, added] of Object.entries(ADDED)) {
      const text = VARIANTS[name]
      if (text === undefined) throw new Error(`missing guide ${name}`)
      // Each declared sentence sits whole in the variant after a space, in reading order, and taking
      // them out leaves the plugin guide.
      const at = added.map(sentence => text.indexOf(` ${sentence}`))
      expect([name, at.every((i, k) => i !== -1 && i > (at[k - 1] ?? -1))]).toEqual([name, true])
      expect([name, added.reduce((rest, sentence) => rest.replace(` ${sentence}`, ''), text)]).toEqual([name, GUIDE])
    }
  })

  test('every variant is built on the guide at the word count it was asked for, except the two that drop the count', async () => {
    const uncounted = ['no-length-rule', 'uncapped']
    for (const [name, text] of Object.entries(VARIANTS)) expect([name, text.includes(`${DEFAULT_SHORT_WORDS} words`)]).toEqual([name, !uncounted.includes(name)])
    expect(Object.keys(VARIANTS)).toEqual(expect.arrayContaining(uncounted))
  })
})

describe('overrides', () => {
  const broken = { rule: 'items-stay-visible', holds: false, evidence: 'not in the skim: memory' } as const
  const override = (holds: boolean, answerSha256: string, reason = 'the toolbar paragraph is its own item') => ({ rule: 'items-stay-visible', holds, reason, answerSha256 }) as const

  test('an override applies only to the answer it was made on, and the latest wins', async () => {
    expect(adjudicate(broken, [], 'hash-1')).toEqual({ holds: false, stale: [] })
    expect(adjudicate(broken, [override(true, 'hash-1')], 'hash-1')).toEqual({ holds: true, by: override(true, 'hash-1'), stale: [] })
    expect(adjudicate(broken, [override(true, 'hash-1'), override(false, 'hash-1', 'on a second read, hidden')], 'hash-1').holds).toBe(false)
    expect(adjudicate(broken, [override(true, 'hash-0')], 'hash-1')).toEqual({ holds: false, stale: [override(true, 'hash-0')] })
    expect(adjudicate({ ...broken, rule: 'adds-words' }, [override(true, 'hash-1')], 'hash-1')).toEqual({ holds: false, stale: [] })
  })
})
