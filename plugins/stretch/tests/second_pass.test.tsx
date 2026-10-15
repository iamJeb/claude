import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { guide } from '../hooks/guide'
import { layout, widthOf } from '../hooks/layout'
import { parse, stretches } from '../hooks/parse'

const FS = (columns: number) => ({ columns, rows: 40, isFullscreen: true })
const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }
const MARKS = /[\ufdd0-\ufdef]/

const mount = ($: Engine, viewport: ReturnType<typeof FS> | undefined, text: string, requestId = 'reply-1') =>
  $.ui.mount({
    plugin: 'stretch',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    ...(viewport !== undefined && { viewport }),
  })
type Mounted = Awaited<ReturnType<typeof mount>>

const engine = (on: On) =>
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
const rowsOf = async (ui: Mounted, key = 'paragraph-0'): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf)
}
const clickAt = async (ui: Mounted, x: number, y: number, key = 'paragraph-0') => {
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
  await ui.advance(2000)
}
/** Clicks the first cell of `phrase` where it is drawn. */
const clickOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  await clickAt(ui, widthOf(row.slice(0, row.indexOf(phrase))), y, key)
}
const hasNote = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).some(t => t.text?.includes('/tui fullscreen') === true)

describe('markup inside markdown', () => {
  test('a stretch inside a link label stays pressable and shows no marks', async $ => {
    const ui = await mount($, FS(100), 'See [{{the docs|the vendor docs page}}](https://x.io/a) now.')
    const rows = (await rowsOf(ui)).join('\n')
    expect(MARKS.test(rows)).toBe(false)
    expect(rows).toBe('See the docs (https://x.io/a) now.')
    await clickOn(ui, 'the docs')
    const opened = (await rowsOf(ui)).join('\n')
    expect(opened).toContain('the vendor docs page «')
    expect(MARKS.test(opened)).toBe(false)
    await ui.unmount()
  })

  test('stretches in bold, italic, a list item and with code in the short form all open', async $ => {
    const text = [
      '- **{{bold one|the bold detail}}** and *{{ital two|the italic detail}}* end',
      '- second {{run `ls -la`|run `ls -la` from the repo root}} then {{x|the ex}}, {{y|the why}}.',
    ].join('\n')
    for (const [phrase, long] of [['bold one', 'the bold detail'], ['ital two', 'the italic detail'], ['ls -la', 'from the repo root'], ['y.', 'the why']] as const) {
      const ui = await mount($, FS(100), text, `a2-${phrase}`)
      await clickOn(ui, phrase)
      expect((await rowsOf(ui)).join('\n')).toContain(long)
      await ui.unmount()
    }
  })

  test('a long form holding a fence and a blank line opens, and the next stretch still opens', async $ => {
    const text = '{{Run the script|Run this:\n\n```sh\n./go.sh --all\n```\n\nthen check}} and finally {{done|really done}}'
    const ui = await mount($, FS(100), text)
    await clickAt(ui, 0, 0)
    expect((await rowsOf(ui)).join('\n')).toContain('./go.sh --all')
    await clickOn(ui, 'done')
    expect((await rowsOf(ui)).join('\n')).toContain('really done')
    await ui.unmount()
  })

  test('template filters without spaces are never stretches', async () => {
    for (const t of [
      'In Jinja, {{name|upper}} uppercases the name.',
      'Angular renders {{amount|currency}} with the locale.',
      'Wikipedia uses {{cite web|url=https://x.io|title=X}} for refs.',
      'Wikipedia uses {{cite web|url=https://x.io title=X}} for refs.',
      'Django: {{value|date:"Y-m-d"}} formats it.',
    ]) {
      expect(stretches(parse(t))).toEqual([])
    }
    expect(stretches(parse('Use {{x|a real phrase}} here.')).length).toBe(1)
  })
})

describe('cell widths', () => {
  test('grapheme clusters measure as the terminal draws them', async () => {
    expect(widthOf('\u{1F468}\u200d\u{1F469}\u200d\u{1F467}')).toBe(2)
    expect(widthOf('\u{1F680}')).toBe(2)
    expect(widthOf('✅')).toBe(2)
    expect(widthOf('⚡')).toBe(2)
    expect(widthOf('\u{20BB7}')).toBe(2)
    expect(widthOf('cafe\u0301')).toBe(4)
    expect(widthOf('Tiếng Việt')).toBe(10)
    expect(widthOf('❤\ufe0f')).toBe(2)
    expect(widthOf('a\u200bb')).toBe(2)
  })

  test('a click lands on the stretch drawn under it after emoji, joiners and combining marks', async $ => {
    for (const lead of ['Team \u{1F468}\u200d\u{1F469}\u200d\u{1F467}', 'cafe\u0301 re\u0301sume\u0301', '\u{1F680} ✅ ⚡', 'Tiếng Việt', '\u{20BB7}\u{20BB7}']) {
      const ui = await mount($, FS(100), `${lead} {{ab|the alpha}} {{cd|the delta}}.`, `w-${lead.length}-${lead.codePointAt(0)}`)
      await clickOn(ui, 'cd')
      const rows = (await rowsOf(ui)).join('\n')
      expect(rows).toContain('the delta «')
      expect(rows).not.toContain('the alpha')
      await ui.unmount()
    }
  })

  test('no row is wider than the region', async () => {
    const line = `${'\u{1F680}'.repeat(5)} w ${'abcd '.repeat(10)}${'\u{20BB7}'.repeat(30)} ${'\u{1F468}\u200d\u{1F469}\u200d\u{1F467}'.repeat(25)}`
    for (const columns of [10, 11, 40]) {
      for (const row of layout(line, columns)) expect(widthOf(row.map(run => run.text).join(''))).toBeLessThanOrEqual(columns)
    }
    const table = `| ${'\u{20BB7}'.repeat(40)} |`
    for (const row of layout(table, 15)) expect(widthOf(row.map(run => run.text).join(''))).toBeLessThanOrEqual(15)
  })

  test('tabs become spaces and noncharacters in a reply never reach the screen', async $ => {
    const ui = await mount($, FS(100), 'a\tb\tc {{ab|the alpha}} x\ufdd0open\ufdd1k\ufdd1y {{cd|the delta}}.')
    const row = (await rowsOf(ui))[0] ?? ''
    expect(row).toBe('a   b   c ab xopenky cd.')
    await clickOn(ui, 'cd')
    expect((await rowsOf(ui)).join('\n')).toContain('the delta «')
    await ui.unmount()
  })
})

describe('clicks at any width', () => {
  const PARA =
    'The deploy failed {{on the cache step|because the cache key hashed only package.json and not the lockfile}} and then ' +
    'retried {{twice|two more times, each one timing out at the ten minute limit}} before {{it gave up|the runner marked the job failed}}, ' +
    'so the fix is {{one line|adding the lockfile to the key in ci/cache.ts}} plus {{a rerun|a manual rerun of the pipeline}}.'
  const pairs = [
    ['on the cache step', 'hashed only package.json'],
    ['twice', 'ten minute limit'],
    ['it gave up', 'marked the job failed'],
    ['one line', 'adding the lockfile'],
    ['a rerun', 'manual rerun of the pipeline'],
  ] as const
  for (const cols of [40, 196]) {
    test(`every stretch opens in turn at ${cols} columns`, async $ => {
      const ui = await mount($, FS(cols), PARA)
      await ui.resize({ columns: cols, rows: 40, in: 'paragraph-0' })
      for (const [short, long] of pairs) {
        await clickOn(ui, short)
        const rows = await rowsOf(ui)
        expect(rows.join(' ')).toContain(long)
        for (const row of rows) expect(widthOf(row)).toBeLessThanOrEqual(cols)
      }
      await ui.unmount()
    })
  }

  test('after a resize from 196 to 40 columns a later stretch still opens', async $ => {
    const ui = await mount($, FS(196), PARA)
    await clickOn(ui, 'twice')
    await ui.resize({ columns: 40, rows: 40, in: 'paragraph-0' })
    const narrow = await rowsOf(ui)
    expect(narrow.every(row => widthOf(row) <= 40)).toBe(true)
    await clickOn(ui, 'a rerun')
    expect((await rowsOf(ui)).join(' ')).toContain('manual rerun of the pipeline')
    await ui.unmount()
  })
})

describe('streaming', () => {
  test('partial markup never shows marks, and the finished reply has its stretch', async ($, on) => {
    engine(on)
    const chunks = ['Intro {{sho', 'Intro {{short|lo', 'Intro {{short|long form}', 'Intro {{short|long form}}', 'Intro {{short|long form}} tail.']
    const ui = await mount($, FS(100), chunks[0] ?? '')
    let last = ''
    for (const c of chunks) {
      await ui.redraw({ text: c, isFirstOfReply: true })
      const md = (await ui.findAll({ type: 'Markdown' })).map(m => m.text ?? '').join('|')
      let client = ''
      try {
        client = (await rowsOf(ui)).join('\n')
      } catch {
        client = ''
      }
      expect(MARKS.test(md + client)).toBe(false)
      last = client
    }
    expect(last).toBe('Intro short tail.')
    await ui.unmount()
  })

  test('a stretch opened while the reply streams stays open as more text arrives', async ($, on) => {
    engine(on)
    const ui = await mount($, FS(100), 'Start {{a|the alpha detail}} and')
    await clickOn(ui, 'a and')
    await ui.redraw({ text: 'Start {{a|the alpha detail}} and then {{b|the beta detail}} end.', isFirstOfReply: true })
    const rows = (await rowsOf(ui)).join('\n')
    expect(rows).toContain('the alpha detail «')
    expect(rows).toContain(' b end.')
    await ui.unmount()
  })
})

describe('state', () => {
  test('the note stays on the first block while literal braces before the first stretch stream in', async $ => {
    const ui = await mount($, MAIN_SCREEN, 'Use ${{ secrets.X }} then {{a|the alpha}}', 'msg-10')
    expect(await hasNote(ui)).toBe(true)
    await ui.redraw({ text: 'Use ${{ secrets.X }} then {{a|the alpha}} and more', isFirstOfReply: true })
    expect(await hasNote(ui)).toBe(true)
    await ui.unmount()
  })

  test('a prompt with no reply yet gets no context line', async ($, on) => {
    on('session.messages', () => ({ value: [] }))
    let ctx: readonly string[] | undefined = ['unset']
    on('prompt.submit', (_$, e) => {
      ctx = e.context
      return { text: e.text, context: e.context }
    })
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
    // The first prompt carries the guide alone, with no line about opens.
    expect(ctx).toEqual([guide(150)])
  })

  test('an open is reported when the short form holds a noncharacter', async ($, on) => {
    const REPLY = 'Answer {{the \ufdd5fix|the long fix}} here.'
    on('session.messages', () => ({ value: [{ role: 'user', text: 'q', toolUses: [] }, { role: 'assistant', text: REPLY, toolUses: [] }] }))
    let ctx: readonly string[] | undefined
    on('prompt.submit', (_$, e) => {
      ctx = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mount($, FS(100), REPLY)
    await clickOn(ui, 'the fix')
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(ctx).toEqual(['Stretch: in your last reply the reader opened "the fix".'])
    await ui.unmount()
  })

  test('keys are positional, so a short form like "a~2" opens only itself', async $ => {
    const text = 'One {{a|the first}} two {{a|the second}} three {{a~2|the third}} end.'
    expect(stretches(parse(text)).map(s => s.key)).toEqual(['0', '1', '2'])
    const ui = await mount($, FS(100), text)
    await clickOn(ui, 'a~2')
    const rows = (await rowsOf(ui)).join('\n')
    expect(rows).toBe('One a two a three the third « end.')
    await ui.unmount()
  })
})
