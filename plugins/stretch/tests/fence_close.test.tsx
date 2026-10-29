import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { closesFence, openingFence, paragraphsOf, parse, stretches, writeOpen } from '../hooks/parse'

// A long form may end in a fenced code block whose closing line carries the braces of the stretch
// around it, written as ```}} on one line. The block closes there and so does the stretch, and
// whatever the reply says after it is read as its own text. These tests hold that line, for the
// parser, for the paragraph cut, and for a reply drawn while it still streams. Every short form
// here reads as a sentence or stands beside other text, so none is opened as a label, and every
// long form has a space, so none reads as template syntax.

const keys = (text: string) => stretches(parse(text)).map(s => [s.key, s.isClosed])

describe('a long form ending in a fenced block closed by its braces', () => {
  test('closes the block and the stretch on the fence line, and the text after it is plain', async () => {
    const text = ['{{Count the rows first.|Count the rows first, with', '', '```bash', 'git push --force-with-lease', '```}}', '', '## Main risks', '', '{{The risks are small.|The risks are small, in the long form.}}', '', 'Bottom line: done.'].join('\n')
    const parts = parse(text)
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(parts[0]).toMatchObject({ short: 'Count the rows first.', long: ['Count the rows first, with\n\n```bash\ngit push --force-with-lease\n```'] })
    expect(parts[1]).toBe('\n\n## Main risks\n\n')
    expect(parts.at(-1)).toBe('\n\nBottom line: done.')
  })

  test('closes nested stretches on one fence line, with spaces between the braces and ~~~ fences too', async () => {
    expect(keys('Lead {{a|{{b|x\n```\ncode\n```}}}}\nafter {{c|the d}}')).toEqual([['0', true], ['0 › 0', true], ['1', true]])
    expect(writeOpen(parse('Lead {{a|{{b|x\n```\ncode\n```}}}}\nafter {{c|the d}}'))).toBe('Lead x\n```\ncode\n```\nafter the d')
    expect(keys('Lead {{a|{{b|x\n~~~~\ncode\n~~~~ }} }}\nafter {{c|the d}}')).toEqual([['0', true], ['0 › 0', true], ['1', true]])
  })

  test('a line such as ```python inside the block still does not close it', async () => {
    const text = ['Lead {{a|the long', '```', '```python', '{{not|a stretch}}', '```}}', 'after {{c|the d}}'].join('\n')
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(parse(text)[1]).toMatchObject({ long: ['the long\n```\n```python\n{{not|a stretch}}\n```'] })
    const plain = ['```', '```python', '{{a|b}}', '```', 'then {{c|the d}}'].join('\n')
    expect(keys(plain)).toEqual([['0', true]])
    expect(writeOpen(parse(plain))).toBe('```\n```python\n{{a|b}}\n```\nthen the d')
  })

  test('a fence line with text after the braces closes the block at the braces, and one outside every stretch closes nothing', async () => {
    // The text after the braces is reply text. It goes on the line after the fence, so the fence
    // still closes once the stretch is drawn open.
    const [, held, rest] = parse('Lead {{a|x\n```\n``` }} more\n```\n}} after')
    expect(held).toMatchObject({ isClosed: true, long: ['x\n```\n``` '] })
    expect(rest).toBe(' \nmore\n```\n}} after')
    expect(parse('```\ncode\n```}}\n{{a|the b}}')).toEqual(['```\ncode\n```}}\n{{a|the b}}'])
  })

  test('the fence helpers read a marker and a closing line as the parser does', async () => {
    expect(openingFence('  ```ts')).toBe('```')
    expect(openingFence('~~~~')).toBe('~~~~')
    expect(openingFence('text ```')).toBeUndefined()
    expect(closesFence('```', '```')).toBe(true)
    expect(closesFence('`````  ', '```')).toBe(true)
    expect(closesFence('```python', '```')).toBe(false)
    expect(closesFence('```', '````')).toBe(false)
    expect(closesFence('~~~', '```')).toBe(false)
  })
})

describe('paragraphs around a fenced block closed by its braces', () => {
  test('the blank line after the fence line cuts, since the stretch has closed', async () => {
    const text = ['Lead {{a|the long', '```', 'code', '```}}', '', 'After {{b|the c}}.'].join('\n')
    expect(paragraphsOf(text)).toEqual([
      { text: 'Lead {{a|the long\n```\ncode\n```}}', hasStretch: true },
      { text: 'After {{b|the c}}.', hasStretch: true },
    ])
  })

  test('a line starting with a fence marker and more text does not close the block, so no blank line inside it cuts', async () => {
    const text = ['```', '```python', '', '{{a|the b}}', '```', 'After.'].join('\n')
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: false }])
  })
})

const FS = { columns: 100, rows: 40, isFullscreen: true }

const mount = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId: 'reply-fence', viewport: FS })
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
const rowsOf = async (ui: Mounted, key: string): Promise<string> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf).join('\n')
}

describe('a reply streaming past a fenced block closed by its braces', () => {
  test('shows the short form once the fence line lands, and the text after it as it arrives', async ($, on) => {
    engine(on)
    const lines = ['{{Count the rows first.|Count the rows first, with', '', '```bash', 'git push', '```}}', '', 'After {{risks|the risks}}.']
    const ui = await mount($, lines.slice(0, 4).join('\n'))
    await ui.redraw({ text: lines.slice(0, 5).join('\n'), isFirstOfReply: true })
    expect(await rowsOf(ui, 'paragraph-0')).toBe('Count the rows first.')
    await ui.redraw({ text: lines.join('\n'), isFirstOfReply: true })
    expect(await rowsOf(ui, 'paragraph-0')).toBe('Count the rows first.')
    expect(await rowsOf(ui, 'paragraph-1')).toBe('After risks.')
    await ui.unmount()
  })
})
