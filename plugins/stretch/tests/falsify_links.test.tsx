import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SHORT_WORDS, guide } from '../hooks/guide'
import { widthOf } from '../hooks/layout'
import { linkUnder } from '../hooks/links'
import { footerLinks, groupLinks } from '../hooks/register'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const HREF = 'https://stretch.invalid/'
const OPEN_ALL = `${HREF}open-all`
const GROUP = `${HREF}group`

// The markup is built from pieces so no tool input carries it whole.
const O = '{'.repeat(2)
const C = '}'.repeat(2)
const REPLY = [`It fails ${O}on a stale cache|because the key hashes ${O}one file|only the manifest${C} alone${C}.`, '', `The fix ${O}is small|adds the lockfile to the key${C}.`].join('\n')

type Api = { role: 'user' | 'assistant'; content: { type: string; text?: string }[] }
const user = (...texts: string[]): Api => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const assistant = (text: string): Api => ({ role: 'assistant', content: [{ type: 'text', text }] })
const conversation = (on: On, api: () => Api[], rows: () => unknown[] = () => []) => {
  const contexts: (readonly string[] | undefined)[] = []
  on('session.messages', ($, e) => ({ value: (e.as === 'api' ? api() : rows()) as never }))
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  return contexts
}
const replyConversation = (on: On) =>
  conversation(
    on,
    () => [user('q', guide(DEFAULT_SHORT_WORDS)), assistant(REPLY)],
    () => [
      { role: 'user', text: 'q', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  )
const submit = ($: Engine, text = 'next') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const mount = ($: Engine, text: string, requestId = 'reply-1', viewport = FULLSCREEN) =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId, viewport })
type Mounted = Awaited<ReturnType<typeof mount>>

const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
const mountGroup = ($: Engine, requestId: string) =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'ToolGroup', props: { calls: [call], isActive: false, isExpanded: true }, requestId, viewport: FULLSCREEN })
type Group = Awaited<ReturnType<typeof mountGroup>>
const engineDraws = (on: On) =>
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.isExpanded ? 'every call' : 'folded'}</Text>
  })
const isOpen = async (ui: Group) => (await ui.find({ text: 'every call' })) !== undefined

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
type Pointable = { drawn: Mounted['drawn']; pointer: Mounted['pointer'] }
const linksRow = async (ui: Pointable, key: string) => textOf(await ui.drawn({ in: key }))
/** The cell a label starts at in the drawn row, by widthOf of what comes before it. */
const cellOf = async (ui: Pointable, key: string, label: string) => {
  const row = await linksRow(ui, key)
  const at = row.indexOf(label)
  if (at === -1) throw new Error(`"${label}" is not drawn:\n${row}`)
  return widthOf(row.slice(0, at))
}
const click = async (ui: Pointable, key: string, x: number, y = 0, button: 'left' | 'right' | 'middle' = 'left') => {
  await ui.pointer({ type: 'down', x, y, button, in: key })
  await ui.pointer({ type: 'up', x, y, button, in: key })
}
const pressLink = async (ui: Pointable, key: string, label: string) => click(ui, key, await cellOf(ui, key, label))
const pressOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  await click(ui, key, widthOf((rows[y] ?? '').slice(0, (rows[y] ?? '').indexOf(phrase))), y)
  await ui.advance(2000)
}

describe('linkUnder geometry', () => {
  test('separator and note cells hit nothing, label edges hit their own label, by widthOf', () => {
    for (const links of [footerLinks(1, 3), groupLinks(false), groupLinks(true)]) {
      const [first, second] = links
      if (first === undefined || second === undefined) throw new Error('two links expected')
      const firstEnd = widthOf(first.label)
      const sepEnd = firstEnd + widthOf(' · ')
      const secondEnd = sepEnd + widthOf(second.label)
      expect(linkUnder(links, 0)).toBe(first)
      expect(linkUnder(links, firstEnd - 1)).toBe(first)
      for (let x = firstEnd; x < sepEnd; x++) expect(linkUnder(links, x)).toBeUndefined()
      expect(linkUnder(links, sepEnd)).toBe(second)
      expect(linkUnder(links, secondEnd - 1)).toBe(second)
      // The two spaces before the note and the note itself.
      for (let x = secondEnd; x < secondEnd + 20; x++) expect(linkUnder(links, x)).toBeUndefined()
      expect(linkUnder(links, -1)).toBeUndefined()
    }
  })

  test('a label with a wide glyph is measured by widthOf, not by its length', () => {
    const links = [
      { href: 'a', label: '世 a' },
      { href: 'b', label: '▸ b' },
    ]
    // The wide character takes two cells, so the first label takes four and the dot starts at four.
    expect(linkUnder(links, 3)).toBe(links[0])
    expect(linkUnder(links, 4)).toBeUndefined()
    expect(linkUnder(links, 6)).toBeUndefined()
    expect(linkUnder(links, 7)).toBe(links[1])
    expect(linkUnder(links, 9)).toBe(links[1])
    expect(linkUnder(links, 10)).toBeUndefined()
  })
})

describe('press geometry through the Client', () => {
  test('the dot, the spaces before the note, the note, row 1, the right button and a drag that ends on a label do nothing', async $ => {
    const ui = await mount($, REPLY)
    await pressOn(ui, 'is small', 'paragraph-1')
    const before = await linksRow(ui, 'all')
    expect(before).toBe('▸ open all · « close all  1 of 3 open')
    const closeAt = await cellOf(ui, 'all', '« close all')
    const noteAt = await cellOf(ui, 'all', '1 of 3 open')
    for (const x of [closeAt - 3, closeAt - 2, closeAt - 1, noteAt - 2, noteAt - 1, noteAt, noteAt + 5]) {
      await click(ui, 'all', x)
      await ui.advance(100)
      expect(await linksRow(ui, 'all')).toBe(before)
    }
    await click(ui, 'all', 0, 1)
    await click(ui, 'all', closeAt, 1)
    await click(ui, 'all', 0, 0, 'right')
    await click(ui, 'all', closeAt, 0, 'middle')
    await ui.pointer({ type: 'down', x: closeAt - 2, y: 0, button: 'left', in: 'all' })
    await ui.pointer({ type: 'move', x: closeAt, y: 0, button: 'left', in: 'all' })
    await ui.pointer({ type: 'up', x: closeAt, y: 0, button: 'left', in: 'all' })
    await ui.pointer({ type: 'move', x: 0, y: 0, in: 'all' })
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe(before)

    // The last cell of open all opens all; the first cell of close all closes all.
    await click(ui, 'all', widthOf('▸ open all') - 1)
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe('« close all  3 of 3 open')
    await pressOn(ui, '«', 'paragraph-1')
    expect(await linksRow(ui, 'all')).toBe('▸ open all · « close all  2 of 3 open')
    await click(ui, 'all', closeAt)
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe('▸ open all  none of 3 open')
    await ui.unmount()
  })

  test('a drag that starts on a label and leaves it before the button comes up does nothing', async $ => {
    const ui = await mount($, REPLY)
    await ui.pointer({ type: 'down', x: 0, y: 0, button: 'left', in: 'all' })
    await ui.pointer({ type: 'move', x: 40, y: 2, button: 'left', in: 'all' })
    await ui.pointer({ type: 'up', x: 40, y: 2, button: 'left', in: 'all' })
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe('▸ open all  none of 3 open')
    await ui.unmount()
  })
})

describe('footer actions', () => {
  test('open all then close all moves every paragraph and the next prompt lists them as opened', async ($, on) => {
    const contexts = replyConversation(on)
    const ui = await mount($, REPLY)
    await pressLink(ui, 'all', '▸ open all')
    await ui.advance(100)
    expect((await rowsOf(ui)).join(' ')).toContain('only the manifest')
    expect((await rowsOf(ui, 'paragraph-1')).join(' ')).toContain('adds the lockfile')
    await pressLink(ui, 'all', '« close all')
    await ui.advance(100)
    expect((await rowsOf(ui)).join(' ')).not.toContain('only the manifest')
    expect((await rowsOf(ui, 'paragraph-1')).join(' ')).not.toContain('adds the lockfile')
    await submit($)
    expect(contexts[0]).toEqual(['Stretch: in your last reply the reader opened "on a stale cache", "one file", "is small".'])
    await ui.unmount()
  })

  test('open all on the second of two replies leaves the first closed', async $ => {
    const one = await mount($, REPLY, 'reply-a')
    const two = await mount($, REPLY, 'reply-b')
    await pressLink(two, 'all', '▸ open all')
    await one.advance(100)
    await two.advance(100)
    expect(await linksRow(one, 'all')).toBe('▸ open all  none of 3 open')
    expect((await rowsOf(one)).join(' ')).not.toContain('because the key')
    expect(await linksRow(two, 'all')).toBe('« close all  3 of 3 open')
    await one.unmount()
    await two.unmount()
  })

  test('a stretch opened by pointer after a footer press is recorded and counted', async ($, on) => {
    const contexts = replyConversation(on)
    const ui = await mount($, REPLY)
    await pressLink(ui, 'all', '▸ open all')
    await ui.advance(100)
    await pressLink(ui, 'all', '« close all')
    await ui.advance(100)
    await pressOn(ui, 'is small', 'paragraph-1')
    expect(await linksRow(ui, 'all')).toBe('▸ open all · « close all  1 of 3 open')
    await submit($)
    expect(contexts[0]?.at(-1)).toContain('"is small"')
    await ui.unmount()
  })
})

describe('group identity', () => {
  test('show opens one alone, show all opens both, fold folds one alone', async ($, on) => {
    engineDraws(on)
    const one = await mountGroup($, 'gid-1')
    const two = await mountGroup($, 'gid-2')
    await pressLink(one, 'tools', '▸ show')
    expect(await isOpen(one)).toBe(true)
    expect(await isOpen(two)).toBe(false)
    await pressLink(one, 'tools', '▾ fold')
    await pressLink(two, 'tools', '▸ show all')
    expect(await isOpen(one)).toBe(true)
    expect(await isOpen(two)).toBe(true)
    await pressLink(two, 'tools', '▾ fold')
    expect(await isOpen(two)).toBe(false)
    expect(await isOpen(one)).toBe(true)
    // The first cell of fold all, just past the dot, folds every group.
    await click(one, 'tools', widthOf('▾ fold · '))
    expect(await isOpen(one)).toBe(false)
    expect(await isOpen(two)).toBe(false)
    await one.unmount()
    await two.unmount()
  })
})

describe('post validation', () => {
  const BAD: unknown[] = [{}, 7, 'open-all', null, [OPEN_ALL], { href: 7 }, { href: `${HREF}../open-all` }, { href: `${HREF}open-all/` }, { href: 'https://other.invalid/open-all' }, { href: `${HREF}open/0` }, { href: `${HREF}groups-open ` }]

  test('a bad post from either row changes nothing and does not throw', async ($, on) => {
    engineDraws(on)
    const ui = await mount($, REPLY)
    const group = await mountGroup($, 'gp-1')
    for (const data of BAD) {
      await ui.post(data as never, { in: 'all' })
      await group.post(data as never, { in: 'tools' })
      await ui.advance(100)
      expect(await linksRow(ui, 'all')).toBe('▸ open all  none of 3 open')
      expect(await isOpen(group)).toBe(false)
    }
    await ui.unmount()
    await group.unmount()
  })

  test('a group address posted from a reply footer does not open a group, and a footer address from a group does not open a reply', async ($, on) => {
    engineDraws(on)
    const ui = await mount($, REPLY, 'shared-id')
    const group = await mountGroup($, 'shared-id')
    await ui.post({ href: GROUP }, { in: 'all' })
    await ui.post({ href: `${HREF}groups-open` }, { in: 'all' })
    expect(await isOpen(group)).toBe(false)
    await group.post({ href: OPEN_ALL }, { in: 'tools' })
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe('▸ open all  none of 3 open')
    await ui.unmount()
    await group.unmount()
  })
})

describe('no address on screen', () => {
  test('every footer and toggle state draws no http and no invalid', async ($, on) => {
    engineDraws(on)
    const ui = await mount($, REPLY)
    const rows: string[] = []
    const trees: string[] = []
    const take = async (target: Pointable, key: string) => {
      rows.push(await linksRow(target, key))
      trees.push(JSON.stringify(await target.drawn({ in: key })))
    }
    await take(ui, 'all')
    await pressOn(ui, 'is small', 'paragraph-1')
    await take(ui, 'all')
    await pressLink(ui, 'all', '▸ open all')
    await ui.advance(100)
    await take(ui, 'all')
    const group = await mountGroup($, 'gu-1')
    await take(group, 'tools')
    await pressLink(group, 'tools', '▸ show')
    await take(group, 'tools')
    expect(rows).toEqual(['▸ open all  none of 3 open', '▸ open all · « close all  1 of 3 open', '« close all  3 of 3 open', '▸ show · ▸ show all', '▾ fold · ▾ fold all'])
    for (const text of [...rows, ...trees]) {
      expect(text).not.toContain('http')
      expect(text).not.toContain('invalid')
    }
    await ui.unmount()
    await group.unmount()
  })
})

describe('narrow terminal', () => {
  test('at 20 columns the row truncates and a visible label still presses', async $ => {
    const narrow = { columns: 20, rows: 40, isFullscreen: true }
    const ui = await mount($, REPLY, 'reply-narrow', narrow)
    await ui.resize({ columns: 18, rows: 1, in: 'all' })
    const tree = await ui.drawn({ in: 'all' })
    expect(JSON.stringify(tree)).toContain('"wrap":"truncate"')
    await pressLink(ui, 'all', '▸ open all')
    await ui.advance(100)
    expect(await linksRow(ui, 'all')).toBe('« close all  3 of 3 open')
    await ui.unmount()
  })
})
