// Falsification of the 0.4.0 interaction and style work: selection and copy, double-click, ctrl-click,
// keyboard letters, the style toolbar and the tinted highlight, and the layout of unspaced scripts and
// emoji. Each test asserts a claim the code or its notes make. The tests that failed against 0.4.0 as
// it first stood sit beside the ones that passed, each with a comment on the rule it now holds to.
// Stretch markup is built with st() so this file can be written while the plugin's tool guard is on.

import type { On, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { hex, mix } from '../hooks/contrast'
import { continuationOf, layout, link, tint, widthOf } from '../hooks/layout'

const OPEN = '{'.repeat(2)
const SHUT = '}'.repeat(2)
/** A stretch written in markup: `short`, opening to `long`. */
const st = (short: string, long: string) => `${OPEN}${short}|${long}${SHUT}`

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const NARROW = { columns: 30, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'

const mountReply = ($: Engine, viewport: typeof FULLSCREEN, text: string, requestId = 'reply-1') =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId, viewport })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
const rowsOf = async (ui: Mounted, key = FIRST): Promise<string[]> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf)
}
const textIn = async (ui: Mounted, key = FIRST) => (await rowsOf(ui, key)).join('\n')
const cellOf = async (ui: Mounted, phrase: string, key = FIRST) => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  return { x: widthOf(row.slice(0, row.indexOf(phrase))), y }
}
const click = async (ui: Mounted, at: { x: number; y: number }, key = FIRST, modifier: { ctrl?: true; alt?: true } = {}) => {
  await ui.pointer({ type: 'down', ...at, button: 'left', ...modifier, in: key })
  await ui.pointer({ type: 'up', ...at, button: 'left', ...modifier, in: key })
}
const pressOn = async (ui: Mounted, phrase: string, key = FIRST) => click(ui, await cellOf(ui, phrase, key), key)
const drag = async (ui: Mounted, from: { x: number; y: number }, to: { x: number; y: number }, key = FIRST) => {
  await ui.pointer({ type: 'down', ...from, button: 'left', in: key })
  await ui.pointer({ type: 'move', ...to, button: 'left', in: key })
  await ui.pointer({ type: 'up', ...to, button: 'left', in: key })
}
const doubleClick = async (ui: Mounted, at: { x: number; y: number }, key = FIRST) => {
  await click(ui, at, key)
  await click(ui, at, key)
}
const inverseIn = async (ui: Mounted, key = FIRST) => (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
const clipboard = (on: On) => {
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  return copies
}
const commands = (on: On, system: string | null = 'Darwin') => {
  const ran: string[][] = []
  const answer = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('process.run', (_, e, next) => {
    if (e.argv[0] === 'uname') return system === null ? next(e) : answer(`${system}\n`)
    ran.push([...e.argv])
    return answer('')
  })
  return ran
}

// 1. Drag

describe('drag selection', () => {
  test('a drag from prose into a fenced code block copies exactly the cells crossed', async ($, on) => {
    const copies = clipboard(on)
    const text = [`Run ${st('the build', 'the full build')} first:`, '```sh', 'npm run build -- --flag', '```'].join('\n')
    const ui = await mountReply($, FULLSCREEN, text)
    const rows = await rowsOf(ui)
    expect(rows[0]?.trimEnd()).toBe('Run the build first:')
    await drag(ui, { x: 4, y: 0 }, { x: 8, y: 1 })
    expect(copies).toEqual([`${(rows[0] ?? '').slice(4).trimEnd()}\n${(rows[1] ?? '').slice(0, 9)}`])
    expect(await textIn(ui)).toContain('Run the build first:')
    await ui.unmount()
  })

  test('a soft-wrapped line copies back as the line written, with no trailing padding; a hard break copies as a newline', async ($, on) => {
    const copies = clipboard(on)
    const line = `Alpha beta gamma delta epsilon zeta eta theta ${st('iota', 'iota kappa')} lambda.`
    const ui = await mountReply($, NARROW, `${line}\nSecond line.`)
    const rows = await rowsOf(ui)
    expect(rows.length).toBeGreaterThan(2)
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: rows.length - 1 })
    expect(copies).toEqual(['Alpha beta gamma delta epsilon zeta eta theta iota lambda.\nSecond line.'])
    await ui.unmount()
  })

  test('a Chinese line wrapped between characters copies back with no space at the row break', async ($, on) => {
    const copies = clipboard(on)
    const head = '这是一个很长的中文句子，用来测试换行之后复制的文字是否连在一起，'
    const ui = await mountReply($, NARROW, `${head}${st('没有空格', '没有 多余的空格')}。`)
    const rows = await rowsOf(ui)
    expect(rows.length).toBeGreaterThan(1)
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: rows.length - 1 })
    expect(copies).toEqual([`${head}没有空格。`])
    await ui.unmount()
  })

  test('a drag that starts on a short form and moves within it selects and opens nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, `It ${st('merged cleanly', 'merged cleanly 3 days ago')} and shipped.`)
    await drag(ui, { x: 3, y: 0 }, { x: 6, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['merg'])
    expect(await textIn(ui)).toBe('It merged cleanly and shipped.')
    await ui.unmount()
  })

  test('a press and release on a short form opens it, a jitter move to the same cell included', async $ => {
    const ui = await mountReply($, FULLSCREEN, `It ${st('merged', 'merged 3 days ago')} and shipped.`)
    await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: FIRST })
    await ui.pointer({ type: 'move', x: 4, y: 0, button: 'left', in: FIRST })
    await ui.pointer({ type: 'up', x: 4, y: 0, button: 'left', in: FIRST })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged 3 days ago « and shipped.')
    await ui.unmount()
  })

  // A click is told from a drag by where the button comes up as well as by any move between: with
  // no move event, a release on another cell, another stretch included, is a drag and opens nothing.
  test('down on one short form and up on another, no move between, opens neither', async $ => {
    const ui = await mountReply($, FULLSCREEN, `Pick ${st('alpha', 'alpha one')} or ${st('beta', 'beta two')} now.`)
    const beta = await cellOf(ui, 'beta')
    await ui.pointer({ type: 'down', x: 5, y: 0, button: 'left', in: FIRST })
    await ui.pointer({ type: 'up', ...beta, button: 'left', in: FIRST })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Pick alpha or beta now.')
    await ui.unmount()
  })
})

describe('links rows: open all, close all, show, fold', () => {
  const linksRow = async (ui: Mounted, key: string) => textOf(await ui.drawn({ in: key }))

  test('a drag from open all to elsewhere opens nothing, and a press on it opens every stretch', async $ => {
    const ui = await mountReply($, FULLSCREEN, `A ${st('one', 'one more')} and ${st('two', 'two more')}.`)
    const row = await linksRow(ui, 'all')
    const x = widthOf(row.slice(0, row.indexOf('open all')))
    await drag(ui, { x, y: 0 }, { x: x + 30, y: 0 }, 'all')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('A one and two.')
    await click(ui, { x, y: 0 }, 'all')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('A one more « and two more «.')
    await ui.unmount()
  })

  test('a press on show all beside a tool group still acts', async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'Ran 1 shell command'}</Text>
    })
    const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
    const ui = await $.ui.mount({
      plugin: 'stretch', surface: 'terminal', component: 'ToolGroup',
      props: { calls: [call], isActive: false, isExpanded: true }, requestId: 'group-1', viewport: FULLSCREEN,
    })
    const row = textOf(await ui.drawn({ in: 'tools' }))
    const x = widthOf(row.slice(0, row.indexOf('▸ show all'))) + 2
    await ui.pointer({ type: 'down', x, y: 0, button: 'left', in: 'tools' })
    await ui.pointer({ type: 'up', x, y: 0, button: 'left', in: 'tools' })
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    await ui.unmount()
  })

  // The row acts only when the button comes up on the cell it went down on, so a drag that starts
  // and ends inside "open all" is a drag and not a press.
  test('a drag inside the open all label opens nothing', async $ => {
    const ui = await mountReply($, FULLSCREEN, `A ${st('one', 'one more')} and ${st('two', 'two more')}.`)
    const row = textOf(await ui.drawn({ in: 'all' }))
    const x = widthOf(row.slice(0, row.indexOf('open all')))
    await drag(ui, { x, y: 0 }, { x: x + 5, y: 0 }, 'all')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('A one and two.')
    await ui.unmount()
  })
})

// 2. Double-click

describe('double-click', () => {
  test('#12806. gives #12806, a backslash path and a URL with a query string come out whole', async ($, on) => {
    const copies = clipboard(on)
    const text = `See #12806. Then src\\hooks\\reply.tsx and https://x.invalid/a?b=1&c=two#frag. Then ${st('a stretch', 'a long stretch')}.`
    const ui = await mountReply($, FULLSCREEN, text)
    const row = (await rowsOf(ui))[0] ?? ''
    await doubleClick(ui, { x: row.indexOf('12806') + 1, y: 0 })
    await doubleClick(ui, { x: row.indexOf('reply') + 1, y: 0 })
    await doubleClick(ui, { x: row.indexOf('b=1'), y: 0 })
    expect(copies).toEqual(['#12806', 'src\\hooks\\reply.tsx', 'https://x.invalid/a?b=1&c=two#frag'])
    await ui.unmount()
  })

  test('a word cut across a row break, wider than the row, rejoins', async ($, on) => {
    const copies = clipboard(on)
    const word = 'Pneumonoultramicroscopicsilicovolcanoconiosis'
    const ui = await mountReply($, NARROW, `Say ${word} twice, ${st('then stop', 'then stop talking')}.`)
    const rows = await rowsOf(ui)
    const second = rows.findIndex((row, i) => i > 0 && /^[a-z]/.test(row))
    expect(second).toBeGreaterThan(0)
    await doubleClick(ui, { x: 2, y: second })
    expect(copies).toEqual([word])
    await ui.unmount()
  })

  test('a double-click on a short form toggles it once and copies nothing; on a « it closes once and copies nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, `It ${st('merged', 'merged 3 days ago')} and shipped.`)
    await doubleClick(ui, { x: 5, y: 0 })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged 3 days ago « and shipped.')
    await doubleClick(ui, await cellOf(ui, '«'))
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('It merged and shipped.')
    expect(copies).toEqual([])
    await ui.unmount()
  })

  // A colon joins a word when a slash or a backslash follows it, so a drive letter stays on its path
  // and a scheme the URL rule does not know stays on its host.
  test('C:\\Users\\me\\a.ts and ssh://host/repo come out whole', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, `Open C:\\Users\\me\\a.ts or ssh://host/repo then ${st('a stretch', 'a long stretch')}.`)
    const row = (await rowsOf(ui))[0] ?? ''
    await doubleClick(ui, { x: row.indexOf('Users') + 1, y: 0 })
    await doubleClick(ui, { x: row.indexOf('host') + 1, y: 0 })
    expect(copies).toEqual(['C:\\Users\\me\\a.ts', 'ssh://host/repo'])
    await ui.unmount()
  })

  // The double-click drops the press it was made from, so a quick third press on the same cell is a
  // single click, which copies nothing and takes the word down.
  test('a click right after a double-click copies nothing more and takes the selection down', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, `The build fails ${st('on a stale cache', 'because of the cache')} today.`)
    await doubleClick(ui, { x: 6, y: 0 })
    expect(copies).toEqual(['build'])
    await click(ui, { x: 6, y: 0 })
    expect({ copies, drawn: await inverseIn(ui) }).toEqual({ copies: ['build'], drawn: [] })
    await ui.unmount()
  })
})

// 3. Ctrl-click on links

describe('ctrl-click', () => {
  test('a ctrl-click on a URL inside a short form opens the URL and never the stretch', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, `Read ${st('the notes at https://x.invalid/n', 'the notes at https://x.invalid/n, all of them')} now.`)
    await click(ui, await cellOf(ui, 'x.invalid'), FIRST, { ctrl: true })
    await ui.advance(2000)
    expect(ran).toEqual([['open', 'https://x.invalid/n']])
    expect(await textIn(ui)).toBe('Read the notes at https://x.invalid/n now.')
    await ui.unmount()
  })

  test('a ctrl-click on a bare file: path or a file: markdown link runs nothing', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, `See [log](file:///C:/x.log) and file:///C:/y.log, ${st('a stretch', 'a long stretch')}.`)
    await click(ui, await cellOf(ui, 'log'), FIRST, { ctrl: true })
    await click(ui, await cellOf(ui, 'y.log'), FIRST, { ctrl: true })
    await ui.advance(200)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  // Windows_NT is what busybox-w32's uname prints; the others name Git Bash, MSYS and Cygwin.
  for (const system of ['MINGW64_NT-10.0-26200', 'MSYS_NT-10.0-26200', 'CYGWIN_NT-10.0', 'Windows_NT', null]) {
    test(`with uname ${system ?? 'absent'}, a URL holding & and quotes goes to rundll32 as one argument`, async ($, on) => {
      const ran = commands(on, system)
      const url = 'https://x.invalid/a?b=1&c="2"&d=%22|calc'
      const ui = await mountReply($, FULLSCREEN, `See [it](${url}) and ${st('a stretch', 'a long stretch')}.`)
      await click(ui, await cellOf(ui, 'it'), FIRST, { ctrl: true })
      await ui.advance(200)
      expect(ran).toEqual([['rundll32', 'url.dll,FileProtocolHandler', url]])
      await ui.unmount()
    })
  }
})

// 4. Keyboard letters

const lettersEngine = (on: On, replies: string[]) => {
  on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.change', ($, e) => ({ text: e.text }))
  on('session.messages', () => ({ value: replies.map(text => ({ role: 'assistant', text, toolUses: [] }) satisfies SessionMessage) }))
}
const typeKey = async ($: Engine, key: Record<string, unknown>) => {
  const hook: unknown = Reflect.get($.prompt, 'edit')
  if (typeof hook !== 'function') throw new Error('no $.prompt.edit')
  const inputText = typeof key.key === 'string' ? key.key : ''
  const box: unknown = await hook.call($.prompt, { origin: { kind: 'composer' }, key, text: '', cursor: 0, start: 0, end: 0, inputText })
  if (typeof box !== 'object' || box === null || !('text' in box) || typeof box.text !== 'string') throw new Error('prompt.edit left no text')
  return box.text
}
const lettersIn = async (ui: Mounted, key = FIRST) =>
  (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.backgroundColor === 'error').map(piece => piece.text.trim())

describe('keyboard letters', () => {
  const reply = (n: number) => `Reply ${n} has ${Array.from({ length: 10 }, (_, i) => st(`r${n}w${i}`, `r${n}w${i} more`)).join(' and ')}.`

  test('three replies with 30 closed stretches: 26 letters, newest reply first, a typed letter opens exactly its stretch', async ($, on) => {
    lettersEngine(on, [reply(1), reply(2), reply(3)])
    const ui1 = await mountReply($, FULLSCREEN, reply(1), 'reply-1')
    const ui2 = await mountReply($, FULLSCREEN, reply(2), 'reply-2')
    const ui3 = await mountReply($, FULLSCREEN, reply(3), 'reply-3')
    await ui3.press({ key: 'open-letters' })
    const order = 'asdfghjklqwertyuiopzxcvbnm'
    expect(await lettersIn(ui3)).toEqual([...order.slice(0, 10)])
    expect(await lettersIn(ui2)).toEqual([...order.slice(10, 20)])
    expect(await lettersIn(ui1)).toEqual([...order.slice(20, 26)])
    // 'w' is reply 2's first stretch.
    expect(await typeKey($, { key: 'w' })).toBe('')
    await ui2.advance(2000)
    expect(await textIn(ui2)).toContain('r2w0 more «')
    expect((await textIn(ui2)).match(/«/g)?.length).toBe(1)
    expect(await textIn(ui1)).not.toContain('«')
    expect(await textIn(ui3)).not.toContain('«')
    expect([...(await lettersIn(ui1)), ...(await lettersIn(ui2)), ...(await lettersIn(ui3))]).toEqual([])
    for (const ui of [ui1, ui2, ui3]) await ui.unmount()
  })

  test('another key clears the letters and is typed; ctrl+a is passed on', async ($, on) => {
    const text = `One ${st('alpha', 'alpha more')} and ${st('beta', 'beta more')}.`
    lettersEngine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await ui.press({ key: 'open-letters' })
    expect(await typeKey($, { key: 'x' })).toBe('x')
    expect(await lettersIn(ui)).toEqual([])
    await ui.press({ key: 'open-letters' })
    expect(await typeKey($, { key: 'a', ctrl: true })).toBe('a')
    expect(await lettersIn(ui)).toEqual([])
    await ui.advance(2000)
    expect(await textIn(ui)).not.toContain('«')
    await ui.unmount()
  })

  test('the close chord letters only the closers of open stretches, nested ones included', async ($, on) => {
    const text = `See ${st('outer', `outer with ${st('inner', 'inner more')} inside`)} and ${st('other', 'other more')} and ${st('third', 'third more')}.`
    lettersEngine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await pressOn(ui, 'outer')
    await ui.advance(2000)
    await pressOn(ui, 'inner')
    await ui.advance(2000)
    await ui.press({ key: 'close-letters' })
    expect((await lettersIn(ui)).sort()).toEqual(['a', 's'])
    expect(await textIn(ui)).not.toContain('«')
    await ui.unmount()
  })

  test('a reply whose stretches are all open takes no open letter', async ($, on) => {
    const older = `Older ${st('one', 'one more')}.`
    const newer = `Newer ${st('two', 'two more')}.`
    lettersEngine(on, [older, newer])
    const a = await mountReply($, FULLSCREEN, older, 'reply-1')
    const b = await mountReply($, FULLSCREEN, newer, 'reply-2')
    await pressOn(b, 'two')
    await b.advance(2000)
    await b.press({ key: 'open-letters' })
    expect(await lettersIn(b)).toEqual([])
    expect(await lettersIn(a)).toEqual(['a'])
    await a.unmount()
    await b.unmount()
  })
})

describe('a stretch written in an unspaced script', () => {
  // A long form with no whitespace reads as template syntax, except where it holds a character of a
  // script that puts no space between words, so a stretch written wholly in Chinese is drawn as one.
  test('a Chinese stretch is drawn by the plugin, not handed on with its braces', async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    const ui = await mountReply($, FULLSCREEN, `他说${st('核心是道。', '核心是道，也就是万物运行的根本规律。')}`)
    expect(await ui.find({ type: 'Client' })).toBeDefined()
    expect(await textIn(ui)).toBe('他说核心是道。')
    await ui.unmount()
  })

  test('a Japanese and a Thai long form with no space open; a single Latin token stays template syntax', async ($, on) => {
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.text}</Text>
    })
    const ui = await mountReply($, FULLSCREEN, `見て${st('要点', '要点はここにある')} ${st('สรุป', 'สรุปคือตรงนี้')} and ${st('name', 'upper')}.`)
    await pressOn(ui, '要点')
    await ui.advance(2000)
    await pressOn(ui, 'สรุป')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe(`見て要点はここにある « สรุปคือตรงนี้ « and ${st('name', 'upper')}.`)
    await ui.unmount()
  })
})

// 5. Style

/** WCAG contrast of two `#rrggbb` colours. */
const contrast = (a: string, b: string) => {
  const lum = (h: string) => {
    const [r = 0, g = 0, bl = 0] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const FOUR = `We ${st('one', 'one more')} then ${st('two', 'two more')} then ${st('three', 'three more')} then ${st('four', 'four more')} done.`
const lightTheme = (on: On) => {
  const theme = { key: 'theme', label: 'Theme', kind: 'choice', value: 'light', provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
  on('config.list', () => ({ value: [theme] }))
}
const propsOf = async (ui: Mounted, phrase: string) => (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === phrase)?.props

describe('style', () => {
  test('marks none draws no underline anywhere in a paragraph holding stretches', { options: { marks: 'none' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN, `See ${st('the outer one', `the outer one, with ${st('an inner one', 'an inner one too')}`)} and ${st('more', 'more here')}.`)
    const underlined = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.props.underline === true).map(piece => piece.text)
    expect(underlined).toEqual([])
    await ui.unmount()
  })

  for (const highlight of ['#12', 'red', '#1234', '#12345g', 'tinted2']) {
    test(`highlight ${highlight} is treated as none`, { options: { highlight } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, FOUR)
      const props = await propsOf(ui, 'one')
      expect(props).toMatchObject({ underline: true })
      expect(props).not.toHaveProperty('backgroundColor')
      expect(props).not.toHaveProperty('color')
      await ui.unmount()
    })
  }

  for (const theme of ['dark', 'light'] as const) {
    test(`tinted on the ${theme} theme: each of the four colours carries text at 4.5:1 or more`, { options: { highlight: 'tinted' } }, async ($, on) => {
      if (theme === 'light') lightTheme(on)
      const ui = await mountReply($, FULLSCREEN, FOUR)
      const pairs = await Promise.all(['one', 'two', 'three', 'four'].map(async phrase => (await propsOf(ui, phrase)) ?? {}))
      const backgrounds = pairs.map(p => String(p.backgroundColor))
      // The four are the palette blended 75 percent into the background, recomputed here with contrast.ts.
      const base = theme === 'dark'
        ? ([[255, 193, 7], [175, 135, 255], [72, 150, 140], [215, 119, 87]] as const)
        : ([[150, 108, 30], [135, 0, 255], [0, 102, 102], [215, 119, 87]] as const)
      const ground = theme === 'dark' ? ([0, 0, 0] as const) : ([255, 255, 255] as const)
      expect(backgrounds).toEqual(base.map(rgb => hex(mix(rgb, ground, 0.75))))
      for (const p of pairs) expect(contrast(String(p.backgroundColor), String(p.color))).toBeGreaterThanOrEqual(4.5)
      await ui.unmount()
    })
  }

  test('save writes exactly stretch.marks and stretch.highlight, and close without save restores the saved look', { options: { marks: 'dim', highlight: '#264f78' } }, async ($, on) => {
    on('session.surfaces', () => ({ value: ['terminal'] }))
    // What is drawn above the prompt once the toolbar steps aside.
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const written: [string, unknown][] = []
    on('config.set', (_, e) => {
      written.push([e.key, e.value])
      return { value: e.value }
    })
    const runStyle = () => $.command.run({ command: 'stretch', args: 'style', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    const mountToolbar = () =>
      $.ui.mount({
        plugin: 'stretch', surface: 'terminal', component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
        viewport: FULLSCREEN,
      })
    await runStyle()
    const first = await mountToolbar()
    await first.press({ key: 'mark-dim' })
    await first.press({ key: 'mark-bold' })
    await first.press({ key: 'highlight-tinted' })
    await first.press({ key: 'save' })
    expect(written.map(([key]) => key).sort()).toEqual(['stretch.highlight', 'stretch.marks'])
    expect(written).toContainEqual(['stretch.marks', 'bold'])
    expect(written).toContainEqual(['stretch.highlight', 'tinted'])
    await first.unmount()

    written.length = 0
    await runStyle()
    const second = await mountToolbar()
    await second.press({ key: 'mark-italic' })
    await second.press({ key: 'highlight-none' })
    await second.press({ key: 'close' })
    expect(written).toEqual([])
    const ui = await mountReply($, FULLSCREEN, FOUR)
    const props = await propsOf(ui, 'one')
    // The saved look this plugin instance loaded with: dim on #264f78.
    expect(props).toMatchObject({ backgroundColor: '#264f78', color: '#a0b1c1' })
    expect(props).not.toHaveProperty('italic')
    await ui.unmount()
    await second.unmount()
  })
})

// 6. Layout

describe('layout of unspaced scripts and emoji', () => {
  test('no row starts with 。 or ，, across widths, links and tints', () => {
    const inputs = [
      '我们今天讨论缓存的问题，因为构建总是失败。缓存键只看了一个文件，所以锁文件改了也不会失效。',
      `前面的话${link('open', 'k', '缓存失效')}。后面${link('open', 'j', '还有')}，再说一句。`,
      `前面${tint('#ffdd77', '加上')}，${tint('#ffdd77', '的字')}。结尾。`,
      '用了`code`。然后**加粗**，结束。',
    ]
    const bad: string[] = []
    for (const text of inputs) {
      for (let width = 10; width <= 60; width++) {
        for (const row of layout(text, width)) {
          const drawn = row.map(run => run.text).join('')
          const body = drawn.slice(continuationOf(row)?.lead ?? 0)
          if (/^[。，]/.test(body)) bad.push(`${width}: ${drawn}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  test('a Thai combining mark takes no cell, and a click after Thai text lands where the eye sees it', async $ => {
    expect(widthOf('\u0e48')).toBe(0)
    expect(widthOf('ที่')).toBe(1)
    expect(widthOf('สวัสดี')).toBe(4)
    // สวัสดี is four cells, a space, then the short form at cell 5.
    const ui = await mountReply($, FULLSCREEN, `สวัสดี ${st('go', 'go now')} ok.`)
    await click(ui, { x: 5, y: 0 })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('สวัสดี go now « ok.')
    await ui.unmount()
  })

  test('an emoji takes two cells and a click one cell past it lands on the word after it', async $ => {
    for (const emoji of ['👍', '❤️', '👨‍👩‍👧', '🇺🇸', '👍🏽']) expect([emoji, widthOf(emoji)]).toEqual([emoji, 2])
    const ui = await mountReply($, FULLSCREEN, `👍${st('go', 'go now')} ok.`)
    await click(ui, { x: 2, y: 0 })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('👍go now « ok.')
    await ui.unmount()
  })

  test('a Chinese long form grows with each short-form character only ever moving right, never back', async $ => {
    const short = '核心是道，与无为。'
    const long = '《道德经》的核心是道，也就是万物运行的 Tao 根本规律，与人顺着道去做事的无为。'
    const ui = await mountReply($, { columns: 200, rows: 40, isFullscreen: true }, `他说${st(short, long)}`)
    await pressOn(ui, '核心')
    const columns: number[][] = []
    for (let i = 0; i < 120; i++) {
      const row = (await rowsOf(ui))[0] ?? ''
      let from = 0
      const at: number[] = []
      for (const ch of short) {
        const k = row.indexOf(ch, from)
        at.push(k === -1 ? -1 : widthOf(row.slice(0, k)))
        from = k + 1
      }
      columns.push(at)
      await ui.advance(16)
    }
    const backward = columns.flatMap((at, i) => (i === 0 ? [] : at.flatMap((x, c) => (x < (columns[i - 1]?.[c] ?? 0) ? [`frame ${i} char ${c}`] : []))))
    expect(columns.every(at => at.every(x => x >= 0))).toBe(true)
    expect(backward).toEqual([])
    expect(columns.at(-1)?.[0]).toBeGreaterThan(columns[0]?.[0] ?? 0)
    await ui.unmount()
  })
})

// 7. Regression: a nested stretch marked » inside an opened long form

describe('nested stretches open on button up', () => {
  test('a nested stretch marked » inside an opened long form opens on a press, on its words or on the » itself', async $ => {
    const text = `Start ${st('outer', `outer holds ${st('middle', `middle holds ${st('deep', 'deep words')} too`)} here`)} end.`
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui)).toBe('Start outer» end.')
    await pressOn(ui, 'outer')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Start outer holds middle» here « end.')
    await pressOn(ui, '»')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Start outer holds middle holds deep too « here « end.')
    await pressOn(ui, 'deep')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Start outer holds middle holds deep words « too « here « end.')
    await ui.unmount()
  })
})
