// Selecting and copying text, double-clicks, ctrl- and alt-clicks on hyperlinks, and letters from
// the keyboard, in the fullscreen terminal where the plugin draws each paragraph holding a stretch.

import type { On, PromptChangeInput, PromptEditInput, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { hrefAt, layout, link, linkAt, tint, widthOf } from '../hooks/layout'

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key.}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const NARROW = { columns: 30, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'
const DOCS = 'Docs at https://x.invalid/docs and {{a stretch|a long stretch}}.'

const mountReply = ($: Engine, viewport: typeof FULLSCREEN, text = REPLY, requestId = 'reply-1') =>
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
const firstRowOf = async (ui: Mounted) => (await rowsOf(ui))[0] ?? ''
/** Presses `phrase` where the Client drew it, as a mouse does: down, then up. The last one when `last`. */
const pressOn = async (ui: Mounted, phrase: string, { key = FIRST, last = false } = {}) => {
  const rows = await rowsOf(ui, key)
  const y = last ? rows.findLastIndex(row => row.includes(phrase)) : rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  const x = widthOf(row.slice(0, last ? row.lastIndexOf(phrase) : row.indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}
/** Drags the left button from `from` to `to` in the paragraph, as a mouse does: down, a move, up. */
const drag = async (ui: Mounted, from: { x: number; y: number }, to: { x: number; y: number }, key = FIRST) => {
  await ui.pointer({ type: 'down', ...from, button: 'left', in: key })
  await ui.pointer({ type: 'move', ...to, button: 'left', in: key })
  await ui.pointer({ type: 'up', ...to, button: 'left', in: key })
}
/** Presses and releases the left button twice on one cell, as a double-click does. */
const doubleClick = async (ui: Mounted, at: { x: number; y: number }, key = FIRST) => {
  for (let i = 0; i < 2; i += 1) {
    await ui.pointer({ type: 'down', ...at, button: 'left', in: key })
    await ui.pointer({ type: 'up', ...at, button: 'left', in: key })
  }
}
/** The text of every run drawn inverse in a paragraph: what a selection highlights. */
const inverseIn = async (ui: Mounted, key = FIRST) => (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.inverse === true).map(piece => piece.text)
/** What reaches the clipboard. */
const clipboard = (on: On) => {
  const copies: string[] = []
  on('ui.copy', (_, e) => {
    copies.push(e.text)
    return { value: { isCopied: true } }
  })
  return copies
}
/** What the plugin toasts. */
const toasts = (on: On) => {
  const said: string[] = []
  on('ui.toast', (_, e) => {
    said.push(e.text)
    return { value: undefined }
  })
  return said
}

describe('layout fixes', () => {
  test('draws Private Use Area characters as written and keeps a link after them pressable', () => {
    const icons = ' '
    const rows = layout(`${icons}${link('open', 'k', 'four')} ok`, 30)
    expect(rows.map(row => row.map(run => run.text).join(''))).toEqual([`${icons}four ok`])
    expect(linkAt(rows, widthOf(icons) + 1, 0)).toEqual({ action: 'open', key: 'k' })
  })

  test('lays out a line holding a mark with no separator after it, reading the mark as text that is never drawn', () => {
    const start = link('open', 'k', 'x').charAt(0)
    const shade = tint('red', 'x').charAt(0)
    expect(layout(`a ${start} b ${shade} c`, 30).map(row => row.map(run => run.text).join(''))).toEqual(['a  b  c'])
  })

  test('a stretch inside a short form written over several lines is drawn, open, with the stretch inside it pressable', async $ => {
    const text = 'Start {{a short form\nover two lines|the long form with {{more|more words}} inside}} end.'
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui)).toBe('Start the long form with more inside end.')
    await pressOn(ui, 'more')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Start the long form with more words « inside end.')
    await ui.unmount()
  })

  test('Nerd Font icons in a reply are drawn as written, and a stretch after them opens', async $ => {
    const text = '  home {{opens|opens wide}} after icons.'
    const ui = await mountReply($, FULLSCREEN, text)
    expect(await textIn(ui)).toBe('  home opens after icons.')
    await pressOn(ui, 'opens')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('  home opens wide « after icons.')
    await ui.unmount()
  })

  test('finds the hyperlink drawn at a cell, and none beside it', () => {
    const rows = layout('see https://x.invalid/a now', 40)
    expect(hrefAt(rows, 4, 0)).toBe('https://x.invalid/a')
    expect(hrefAt(rows, 22, 0)).toBe('https://x.invalid/a')
    expect(hrefAt(rows, 3, 0)).toBeUndefined()
    expect(hrefAt(rows, 23, 0)).toBeUndefined()
  })

  test('a bare URL is a hyperlink, without the punctuation that ends its sentence or a bracket it did not open', () => {
    const hrefs = (text: string) => layout(text, 80).flatMap(row => row.flatMap(run => (run.href === undefined ? [] : [run.href])))
    expect(hrefs('See https://x.invalid/a, then (https://x.invalid/b). Not inhttps://x.invalid/c.')).toEqual(['https://x.invalid/a', 'https://x.invalid/b'])
    expect(hrefs('At https://x.invalid/a_(b) and https://x.invalid/d/')).toEqual(['https://x.invalid/a_(b)', 'https://x.invalid/d/'])
  })

  test('a markdown link to a web page or a file is a hyperlink, and one to a relative path keeps its target beside it', () => {
    const flat = (text: string) => layout(text, 80).map(row => row.map(run => `${run.text}${run.href === undefined ? '' : `<${run.href}>`}`).join('')).join('\n')
    expect(flat('[the docs](https://x.invalid/docs) and [a log](file:///tmp/x.log)')).toBe('the docs<https://x.invalid/docs> and a log<file:///tmp/x.log>')
    expect(flat('[the file](hooks/reply.tsx)')).toBe('the file (hooks/reply.tsx)')
  })
})

describe('selecting text', () => {
  test('a drag across a paragraph that holds a stretch copies the text it crossed, drawn inverse, and opens nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    // "The build fails on a stale cache»." then "Braces in code stay: {{a|b}}."
    await drag(ui, { x: 4, y: 0 }, { x: 5, y: 1 })
    expect(copies).toEqual(['build fails on a stale cache».\nBraces'])
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    expect(pieces.find(piece => piece.text === 'build fails ')?.props).toMatchObject({ inverse: true })
    expect(pieces.find(piece => piece.text === 'The ')?.props).not.toHaveProperty('inverse')
    expect(await textIn(ui)).toBe('The build fails on a stale cache».\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a drag backwards selects from where it came up to where it went down', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 14, y: 0 }, { x: 4, y: 0 })
    expect(copies).toEqual(['build fails'])
    await ui.unmount()
  })

  test('a line wrapped over several rows is copied as one line', async ($, on) => {
    const copies = clipboard(on)
    const text = '- A list item {{long enough|long enough}} that it wraps onto a second row here.'
    const ui = await mountReply($, NARROW, text)
    const rows = (await rowsOf(ui)).map(row => row.trimEnd())
    expect(rows.length).toBeGreaterThan(1)
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: rows.length - 1 })
    expect(copies).toEqual(['- A list item long enough that it wraps onto a second row here.'])
    await ui.unmount()
  })

  test('a code fence in the same block as a stretch is selected and copied as written', async ($, on) => {
    const copies = clipboard(on)
    const text = ['Run {{the build|the full build}} first:', '```sh', 'npm run build -- --flag', '```'].join('\n')
    const ui = await mountReply($, FULLSCREEN, text)
    const rows = await rowsOf(ui)
    const code = rows.findIndex(row => row.includes('npm run build'))
    expect(code).toBe(1)
    await drag(ui, { x: 0, y: code }, { x: 200, y: code })
    expect(copies).toEqual(['  npm run build -- --flag'])
    await drag(ui, { x: 0, y: 0 }, { x: 200, y: code })
    expect(copies.at(-1)).toBe('Run the build first:\n  npm run build -- --flag')
    await ui.unmount()
  })

  test('a URL in a paragraph that holds a stretch is drawn as a hyperlink', async $ => {
    const ui = await mountReply($, FULLSCREEN, DOCS)
    const drawn = await ui.find({ type: 'Link', in: FIRST })
    expect(drawn?.props).toMatchObject({ href: 'https://x.invalid/docs' })
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a stretch.')
    await ui.unmount()
  })

  test('a click copies nothing, takes the highlight down, and on a short form still opens it', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 4, y: 0 }, { x: 8, y: 0 })
    expect(await inverseIn(ui)).toEqual(['build'])
    await drag(ui, { x: 1, y: 1 }, { x: 1, y: 1 })
    expect(copies).toEqual(['build'])
    expect(await inverseIn(ui)).toEqual([])
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    expect(copies).toEqual(['build'])
    await ui.unmount()
  })

  test('a drag that starts on a short form selects and opens nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'It {{merged|merged 3 days ago}} and shipped.')
    await drag(ui, { x: 3, y: 0 }, { x: 8, y: 0 })
    await ui.advance(2000)
    expect(copies).toEqual(['merged'])
    expect(await textIn(ui)).toBe('It merged and shipped.')
    await ui.unmount()
  })

  test('a drag released off the paragraph, past any edge, still copies and leaves no highlight behind', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const off of [{ x: 4, y: 30 }, { x: 4, y: -2 }, { x: -3, y: 1 }, { x: 150, y: 1 }]) {
      await drag(ui, { x: 4, y: 0 }, off)
      expect(await inverseIn(ui)).toEqual([])
    }
    expect(copies).toEqual([
      'build fails on a stale cache».\nBraces in code stay: {{a|b}}.',
      'The b',
      'build fails on a stale cache».\nB',
      'build fails on a stale cache».\nBraces in code stay: {{a|b}}.',
    ])
    await ui.unmount()
  })

  test('a selection left on screen goes when the pointer leaves the paragraph', async ($, on) => {
    clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 4, y: 0 }, { x: 8, y: 0 })
    expect(await inverseIn(ui)).toEqual(['build'])
    await ui.pointer({ type: 'leave', x: 8, y: 0, in: FIRST })
    expect(await inverseIn(ui)).toEqual([])
    await ui.unmount()
  })

  test('a selection across the rows a list item wraps onto draws selected only the cells it copies', async ($, on) => {
    const copies = clipboard(on)
    const url = 'https://x.invalid/some/long/path/16'
    const ui = await mountReply($, NARROW, `- See ${url} and {{a stretch|a long stretch}}.`)
    const rows = await rowsOf(ui)
    const bottom = rows.findIndex(row => row.includes('/16'))
    expect(bottom).toBeGreaterThan(0)
    await drag(ui, { x: 0, y: 0 }, { x: 4, y: bottom })
    // Row 0 is "- See", the URL is cut where the row ends, and the lead of the rows after is not copied.
    expect(copies).toEqual(['- See https://x.invalid/some/long/pat'])
    expect((await inverseIn(ui)).join('')).toBe('- Seehttps://x.invalid/some/long/pat')
    await ui.unmount()
  })
})

describe('double-click', () => {
  test('a double-click copies the word under it, drawn inverse', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await doubleClick(ui, { x: 6, y: 0 })
    expect(copies).toEqual(['build'])
    expect(await inverseIn(ui)).toEqual(['build'])
    expect(await textIn(ui)).toBe('The build fails on a stale cache».\nBraces in code stay: {{a|b}}.')
    await ui.unmount()
  })

  test('a double-click takes an id whole, without the punctuation after it', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'See #12806, NMC-2628 and hooks/reply.tsx. Then {{a stretch|a long stretch}}.')
    const row = await firstRowOf(ui)
    for (const id of ['#12806', 'NMC-2628', 'hooks/reply.tsx']) await doubleClick(ui, { x: row.indexOf(id) + 2, y: 0 })
    expect(copies).toEqual(['#12806', 'NMC-2628', 'hooks/reply.tsx'])
    await ui.unmount()
  })

  test('a double-click keeps the marks a path, a dotfile or a flag starts with', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Pass --plugin-dir to ~/.claude, then open .gitignore and /Users/me/a.ts, from .. up. Then {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    const words = ['--plugin-dir', '~/.claude', '.gitignore', '/Users/me/a.ts', '..']
    for (const word of words) await doubleClick(ui, { x: row.indexOf(` ${word}`) + 2, y: 0 })
    expect(copies).toEqual(words)
    await ui.unmount()
  })

  test('a double-click takes a URL whole, and a word of a link label alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'See https://x.invalid/some/path/16. Then read [the docs](https://x.invalid/docs) and {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    await doubleClick(ui, { x: row.indexOf('some'), y: 0 })
    await doubleClick(ui, { x: row.indexOf('docs'), y: 0 })
    expect(copies).toEqual(['https://x.invalid/some/path/16', 'docs'])
    await ui.unmount()
  })

  test('a double-click takes a URL drawn as code, with a file scheme, or in brackets, whole and alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Serve `http://localhost:5173`, open file:///Users/me/a.ts. (See https://x.invalid/a_(b)). Then {{a stretch|a long stretch}}.'
    const ui = await mountReply($, FULLSCREEN, text)
    const row = await firstRowOf(ui)
    for (const at of ['localhost', 'Users', 'x.invalid']) await doubleClick(ui, { x: row.indexOf(at), y: 0 })
    expect(copies).toEqual(['http://localhost:5173', 'file:///Users/me/a.ts', 'https://x.invalid/a_(b)'])
    await ui.unmount()
  })

  test('a double-click takes a URL a line wrapped inside whole, from either of its rows', async ($, on) => {
    const copies = clipboard(on)
    const url = 'https://x.invalid/some/long/path/16'
    const ui = await mountReply($, NARROW, `See ${url} and {{a stretch|a long stretch}}.`)
    const rows = await rowsOf(ui)
    const top = rows.findIndex(row => row.includes('https'))
    const bottom = rows.findIndex(row => row.includes('/16'))
    expect(bottom).toBeGreaterThan(top)
    await doubleClick(ui, { x: (rows[top] ?? '').indexOf('https') + 2, y: top })
    // Two cells on from the first, so the next press is not a third click of the double-click before it.
    await doubleClick(ui, { x: (rows[bottom] ?? '').indexOf('/16') + 2, y: bottom })
    expect(copies).toEqual([url, url])
    await ui.unmount()
  })

  test('a double-click on the last word of a row a line wrapped at a space takes that word alone', async ($, on) => {
    const copies = clipboard(on)
    const text = 'Each word stays apart where a line wraps at a space between two words, {{a stretch|a long stretch}}.'
    const ui = await mountReply($, NARROW, text)
    const row = (await firstRowOf(ui)).trimEnd()
    await doubleClick(ui, { x: row.length - 1, y: 0 })
    expect(copies).toEqual([row.split(' ').at(-1)])
    await ui.unmount()
  })

  test('a double-click picks a one-letter word, and on a space picks nothing', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, 'Pick a word, then {{a stretch|a long stretch}}.')
    await doubleClick(ui, { x: 'Pick '.length, y: 0 })
    await doubleClick(ui, { x: 'Pick'.length, y: 0 })
    expect(copies).toEqual(['a'])
    await ui.unmount()
  })

  test('two clicks more than a cell apart, or over 500 ms apart, are two clicks', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await drag(ui, { x: 7, y: 0 }, { x: 7, y: 0 })
    expect(copies).toEqual([])
    // As of Claude Code 2.1.303, `ui.advance` does not move `performance.now()`, which the plugin reads
    // for a press's time, so the test waits the time out.
    const until = performance.now() + 520
    while (performance.now() < until) continue
    await drag(ui, { x: 7, y: 0 }, { x: 7, y: 0 })
    expect(copies).toEqual([])
    await drag(ui, { x: 8, y: 0 }, { x: 8, y: 0 })
    expect(copies).toEqual(['build'])
    await ui.unmount()
  })

  test('a press that opens a stretch between two clicks keeps them from making a double-click', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    await pressOn(ui, 'on a stale cache')
    await drag(ui, { x: 5, y: 0 }, { x: 5, y: 0 })
    expect(copies).toEqual([])
    await ui.unmount()
  })

  test('a double-click on a short form opens it once and picks no word', async ($, on) => {
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    const row = await firstRowOf(ui)
    await doubleClick(ui, { x: row.indexOf('stale'), y: 0 })
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    expect(copies).toEqual([])
    await ui.unmount()
  })
})

describe('hyperlinks', () => {
  /**
   * Answers each command the plugin runs, and keeps the argument vector of each but `uname -s`, which
   * names `system`; with none, `uname` does not start, as on Windows without Git Bash.
   */
  const commands = (on: On, { system = 'Darwin', exitCode = 0 }: { system?: string | null; exitCode?: number } = {}) => {
    const ran: string[][] = []
    const answer = (stdout: string) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    on('process.run', (_, e, next) => {
      if (e.argv[0] === 'uname') return system === null ? next(e) : answer(`${system}\n`)
      ran.push([...e.argv])
      return answer('')
    })
    return ran
  }
  /** Clicks cell `at` with a modifier held, as a mouse does: down, then up. */
  const clickWith = async (ui: Mounted, at: { x: number; y: number }, modifier: { ctrl?: true; alt?: true }) => {
    await ui.pointer({ type: 'down', ...at, button: 'left', ...modifier, in: FIRST })
    await ui.pointer({ type: 'up', ...at, button: 'left', ...modifier, in: FIRST })
  }

  test("a ctrl- or alt-click on a hyperlink opens it with the machine's own opener, and selects nothing", async ($, on) => {
    const ran = commands(on)
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await clickWith(ui, { x: 10, y: 0 }, { ctrl: true })
    await clickWith(ui, { x: 28, y: 0 }, { alt: true })
    await ui.advance(100)
    expect(ran).toEqual([['open', 'https://x.invalid/docs'], ['open', 'https://x.invalid/docs']])
    expect(copies).toEqual([])
    expect(await inverseIn(ui)).toEqual([])
    await ui.unmount()
  })

  test('a plain click on a hyperlink opens nothing, and a drag across it, ctrl held or not, still copies', async ($, on) => {
    const ran = commands(on)
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await drag(ui, { x: 10, y: 0 }, { x: 10, y: 0 })
    await drag(ui, { x: 8, y: 0 }, { x: 30, y: 0 })
    await ui.pointer({ type: 'down', x: 10, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.pointer({ type: 'move', x: 30, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.pointer({ type: 'up', x: 30, y: 0, button: 'left', ctrl: true, in: FIRST })
    await ui.advance(100)
    expect(ran).toEqual([])
    expect(copies).toEqual(['https://x.invalid/docs', 'tps://x.invalid/docs'])
    await ui.unmount()
  })

  test("a ctrl-click on a file: link opens nothing: the terminal's own click is left to open it", async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, 'See [the log](file:///tmp/x.log) and {{a stretch|a long stretch}}.')
    await clickWith(ui, { x: 6, y: 0 }, { ctrl: true })
    await ui.advance(100)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('a modified click away from a hyperlink acts as a plain one: on a short form it opens the stretch', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await clickWith(ui, { x: 36, y: 0 }, { ctrl: true })
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Docs at https://x.invalid/docs and a long stretch «.')
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('a hyperlink inside a short form opens on a modified click, and the stretch on a plain one', async ($, on) => {
    const ran = commands(on)
    const ui = await mountReply($, FULLSCREEN, 'Read {{the [guide](https://x.invalid/g)|the [guide](https://x.invalid/g), part two}} now.')
    await clickWith(ui, { x: 10, y: 0 }, { alt: true })
    await ui.advance(100)
    expect(ran).toEqual([['open', 'https://x.invalid/g']])
    expect(await textIn(ui)).toBe('Read the guide now.')
    await pressOn(ui, 'guide')
    await ui.advance(2000)
    expect(await textIn(ui)).toBe('Read the guide, part two « now.')
    await ui.unmount()
  })

  test('a hyperlink that could not be opened is said so', async ($, on) => {
    commands(on, { exitCode: 1 })
    const said = toasts(on)
    const ui = await mountReply($, FULLSCREEN, DOCS)
    await clickWith(ui, { x: 10, y: 0 }, { ctrl: true })
    await ui.advance(100)
    expect(said).toEqual(['stretch: could not open https://x.invalid/docs'])
    await ui.unmount()
  })

  // On Windows the URL goes to rundll32, which runs no shell: `cmd /c start` would read the `&` as its own.
  for (const [system, opener] of [
    ['Linux', ['sh', '-c', 'xdg-open "$1" </dev/null >/dev/null 2>&1', 'sh']],
    ['MINGW64_NT-10.0-26200', ['rundll32', 'url.dll,FileProtocolHandler']],
    [null, ['rundll32', 'url.dll,FileProtocolHandler']],
  ] as const) {
    test(`with uname naming ${system ?? 'nothing'}, a hyperlink opens with ${opener.at(-1) === 'sh' ? 'xdg-open' : opener[0]}`, async ($, on) => {
      const ran = commands(on, { system })
      const ui = await mountReply($, FULLSCREEN, 'See https://x.invalid/a?b=1&c=2 and {{a stretch|a long stretch}}.')
      await clickWith(ui, { x: 6, y: 0 }, { ctrl: true })
      await ui.advance(100)
      expect(ran).toEqual([[...opener, 'https://x.invalid/a?b=1&c=2']])
      await ui.unmount()
    })
  }
})

describe('keyboard', () => {
  /** Presses the Button that alt+down (`down`) or alt+up (`up`) presses, to put up letters that open or close. */
  const down = (ui: Mounted) => ui.press({ key: 'open-letters' })
  const up = (ui: Mounted) => ui.press({ key: 'close-letters' })
  // The test engine raises prompt.edit and prompt.change as the prompt box does, but has no editor
  // beneath them: each test stands one in, and the session's messages, in the order the replies were written.
  const engine = (on: On, replies = [REPLY]) => {
    on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.change', ($, e) => ({ text: e.text }))
    on('session.messages', () => ({ value: replies.map(text => ({ role: 'assistant', text, toolUses: [] }) satisfies SessionMessage) }))
  }
  /** Raises `prompt.<name>` on the test engine's `$.prompt`, whose types leave it out (Claude Code 2.1.312). */
  const raise = async ($: Engine, name: 'edit' | 'change', input: PromptEditInput | PromptChangeInput): Promise<unknown> => {
    const hook: unknown = Reflect.get($.prompt, name)
    if (typeof hook !== 'function') throw new Error(`the test engine has no $.prompt.${name}`)
    return hook.call($.prompt, input)
  }
  /** One key typed at an empty prompt, and the prompt it leaves. */
  const type = async ($: Engine, key: string) => {
    const box = await raise($, 'edit', { origin: { kind: 'composer' }, key: { key }, text: '', cursor: 0, start: 0, end: 0, inputText: key })
    if (typeof box !== 'object' || box === null || !('text' in box) || typeof box.text !== 'string') throw new Error('prompt.edit left no text')
    return box.text
  }
  /** The letters drawn over the stretches of one paragraph. */
  const letters = async (ui: Mounted, key = FIRST) =>
    (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.backgroundColor === 'error').map(piece => piece.text)
  const both = async (ui: Mounted) => [...(await letters(ui)), ...(await letters(ui, 'paragraph-1'))]

  test('the open-letters Button draws a letter over each closed stretch, and typing it opens the stretch in place', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    // The letter covers the short form's first character, so nothing on screen moves.
    expect(await textIn(ui)).toContain('The build fails an a stale cache».')
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only')
    // Again, the stretch now drawn inside the opened one takes a letter.
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    expect(await textIn(ui)).toContain('a set in one file')
    await ui.unmount()
  })

  test('the rest of a short form under its letter stays underlined, on the permission colour', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    const lettered = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => ['error', 'permission'].includes(String(piece.props.backgroundColor)))
    expect(lettered.map(piece => piece.text)).toEqual(['a', 'n a stale cache', '»'])
    for (const piece of lettered) expect(piece.props).toMatchObject({ underline: true })
    await ui.unmount()
  })

  test('the close-letters Button draws a letter over the « of each open stretch, and typing it closes the stretch', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await up(ui)
    // With nothing open there is nothing to close, so no letters show and the key is typed.
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')

    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    expect(await textIn(ui)).not.toContain('«')
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('The build fails on a stale cache».')
    await ui.unmount()
  })

  test('another key, or a letter no stretch has, puts the letters away and is typed as usual', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    for (const key of ['1', 'z', 'A']) {
      await down(ui)
      expect(await type($, key)).toBe(key)
      expect(await both(ui)).toEqual([])
    }
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('each Button names the keybinding action whose chords press it', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    expect((await ui.find({ key: 'open-letters' }))?.props.action).toBe('app:diffFileListDown')
    expect((await ui.find({ key: 'close-letters' }))?.props.action).toBe('app:diffFileListUp')
    await ui.unmount()
  })

  test('the same chord again puts the letters away, and the other one swaps them', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await down(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')

    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    await up(ui)
    expect(await both(ui)).toEqual(['a'])
    await ui.unmount()
  })

  test('a letter drawn nowhere acts on nothing: the « of a stretch still growing open', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    // The hooks count the stretch open as the press lands, so it takes a letter to close it, which
    // no « shows until it has grown.
    await up(ui)
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only')
    await ui.unmount()
  })

  test('a recalled prompt puts the letters away', async ($, on) => {
    engine(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await raise($, 'change', { text: 'an earlier prompt', cursor: 17, origin: { kind: 'history' } })
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('sending a prompt puts the letters away', async ($, on) => {
    engine(on)
    on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    expect(await both(ui)).toEqual(['a', 's'])
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(await both(ui)).toEqual([])
    expect(await type($, 'a')).toBe('a')
    await ui.unmount()
  })

  test('a letter put up before the stretch around it closed opens nothing', async ($, on) => {
    engine(on)
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    // Letter a goes to the stretch inside the open one; a click then closes the open one.
    await down(ui)
    await pressOn(ui, '«')
    await ui.advance(2000)
    expect(await type($, 'a')).toBe('')
    await ui.advance(2000)
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context?.at(-1)).toBe('Stretch: in your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".')
    await ui.unmount()
  })

  test('past the 26th stretch none takes a letter, one keyed constructor among them', async ($, on) => {
    const text = `${Array.from({ length: 26 }, (_, i) => `{{w${i}|more ${i}}}`).join(' ')} {{constructor|more}}`
    engine(on, [text])
    const ui = await mountReply($, FULLSCREEN, text)
    await down(ui)
    expect(await letters(ui)).toHaveLength(26)
    expect(await textIn(ui)).toContain('constructor')
    await ui.unmount()
  })

  test('the three newest replies on screen holding a stretch take letters, newest first, whatever order they were drawn in', async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2), reply(3), reply(4), 'Reply 5 has no stretch.'])
    const mounted = new Map<number, Mounted>()
    for (const n of [4, 2, 1, 3]) mounted.set(n, await mountReply($, FULLSCREEN, reply(n), `reply-${n}`))
    const of = (n: number) => {
      const ui = mounted.get(n)
      if (ui === undefined) throw new Error(`reply ${n} is not mounted`)
      return ui
    }
    await down(of(4))
    expect(await letters(of(4))).toEqual(['a'])
    expect(await letters(of(3))).toEqual(['s'])
    expect(await letters(of(2))).toEqual(['d'])
    expect(await letters(of(1))).toEqual([])
    for (const ui of mounted.values()) await ui.unmount()
  })

  test('a reply scrolled off screen takes no letters', async ($, on) => {
    const reply = (n: number) => `Reply ${n} {{says|says more}}.`
    engine(on, [reply(1), reply(2)])
    const older = await mountReply($, FULLSCREEN, reply(1), 'reply-1')
    const newer = await mountReply($, FULLSCREEN, reply(2), 'reply-2')
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: null })
    await down(older)
    expect(await letters(newer)).toEqual([])
    expect(await letters(older)).toEqual(['a'])
    await type($, '1')

    // Scrolled back into view, it is the newest reply on screen again.
    await newer.redraw({ text: reply(2), isFirstOfReply: true, onScreen: { first: 0, last: 2, of: 3 } })
    await down(older)
    expect(await letters(newer)).toEqual(['a'])
    expect(await letters(older)).toEqual(['s'])
    await older.unmount()
    await newer.unmount()
  })

  test('with letters up, a drag still selects and copies, and the letters stay', async ($, on) => {
    engine(on)
    const copies = clipboard(on)
    const ui = await mountReply($, FULLSCREEN)
    await down(ui)
    await drag(ui, { x: 4, y: 0 }, { x: 8, y: 0 })
    expect({ copied: copies, drawn: await inverseIn(ui), letters: await letters(ui) }).toEqual({ copied: ['build'], drawn: ['build'], letters: ['a'] })
    await ui.unmount()
  })
})
