import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SHORT_WORDS, guide } from '../hooks/guide'
import { widthOf } from '../hooks/layout'
import { hasNested, parse, stretches, writeOpen } from '../hooks/parse'
import { footerLinks, USAGE } from '../hooks/register'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const HREF = 'https://stretch.invalid/'
const OPEN_ALL = `${HREF}open-all`
const CLOSE_ALL = `${HREF}close-all`

// Three linkable stretches over two paragraphs, one of them nested.
const REPLY = [
  'It fails {{on a stale cache|because the key hashes {{one file|only the manifest}} alone}}.',
  '',
  'The fix {{is small|adds the lockfile to the key}}.',
].join('\n')

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
const submit = ($: Engine, text = 'next') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const stretchCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'stretch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

const mount = ($: Engine, text: string, requestId = 'reply-1', surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'stretch',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    ...(surface === 'terminal' && { viewport: FULLSCREEN }),
  })
type Mounted = Awaited<ReturnType<typeof mount>>

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
/** Every styled run of a drawn paragraph: its text and the props it is drawn with. */
const runsOf = async (ui: Mounted, key = 'paragraph-0'): Promise<{ text: string; props: Record<string, unknown> }[]> => {
  const out: { text: string; props: Record<string, unknown> }[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const props = 'props' in node && typeof node.props === 'object' && node.props !== null ? (node.props as Record<string, unknown>) : {}
    const children: unknown = 'children' in node ? node.children : []
    if (Array.isArray(children) && children.every(child => typeof child === 'string')) out.push({ text: children.join(''), props })
    else walk(children)
  }
  walk(await ui.drawn({ in: key }))
  return out
}
const pressOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const x = widthOf((rows[y] ?? '').slice(0, (rows[y] ?? '').indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
  await ui.advance(2000)
}
/** The one row a links Client draws, as its text. */
const linksRow = async (ui: { drawn: Mounted['drawn'] }, key: string) => textOf(await ui.drawn({ in: key }))
/** Presses the label in a links Client's row, at the cell its first character takes. */
const pressLink = async (ui: { drawn: Mounted['drawn']; pointer: Mounted['pointer'] }, key: string, label: string) => {
  const row = await linksRow(ui, key)
  const at = row.indexOf(label)
  if (at === -1) throw new Error(`"${label}" is not drawn:\n${row}`)
  const x = widthOf(row.slice(0, at))
  await ui.pointer({ type: 'down', x, y: 0, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y: 0, button: 'left', in: key })
}
const footer = async (ui: Mounted) => ((await ui.find({ key: 'all' })) === undefined ? '' : linksRow(ui, 'all'))

describe('open all and close all under a reply', () => {
  test('the footer opens and closes every stretch of the block, nested ones too, and they count as read', async ($, on) => {
    const contexts = conversation(
      on,
      () => [user('q', guide(DEFAULT_SHORT_WORDS)), assistant(REPLY)],
      () => [
        { role: 'user', text: 'q', toolUses: [] },
        { role: 'assistant', text: REPLY, toolUses: [] },
      ],
    )
    const ui = await mount($, REPLY)
    expect(await footer(ui)).toBe('▸ open all  none of 3 open')

    await pressLink(ui, 'all', '▸ open all')
    await ui.advance(100)
    expect((await rowsOf(ui)).join(' ')).toContain('because the key hashes only the manifest « alone «.')
    expect((await rowsOf(ui, 'paragraph-1')).join(' ')).toContain('adds the lockfile to the key «')
    expect(await footer(ui)).toBe('« close all  3 of 3 open')

    await pressLink(ui, 'all', '« close all')
    await ui.advance(100)
    expect((await rowsOf(ui)).join('\n')).toBe('It fails on a stale cache».')
    expect((await rowsOf(ui, 'paragraph-1')).join('\n')).toBe('The fix is small.')
    expect(await footer(ui)).toBe('▸ open all  none of 3 open')

    await submit($)
    expect(contexts[0]).toEqual(['Stretch: in your last reply the reader opened "on a stale cache", "one file", "is small".'])
    await ui.unmount()
  })

  test('a press on one stretch moves the count and shows both links', async $ => {
    const ui = await mount($, REPLY)
    expect(await footer(ui)).toBe('▸ open all  none of 3 open')
    await pressOn(ui, 'is small', 'paragraph-1')
    expect(await footer(ui)).toBe('▸ open all · « close all  1 of 3 open')
    // The press lands on close all, past open all and the dot between them.
    await pressLink(ui, 'all', '« close all')
    await ui.advance(100)
    expect(await footer(ui)).toBe('▸ open all  none of 3 open')
    await pressOn(ui, 'is small', 'paragraph-1')
    await pressOn(ui, '«', 'paragraph-1')
    expect(await footer(ui)).toBe('▸ open all  none of 3 open')
    await ui.unmount()
  })

  test('a block with one stretch has no footer, and the footer aims at its own reply alone', async $ => {
    const one = await mount($, 'The fix {{is small|adds the lockfile to the key}}.', 'reply-one')
    expect(await one.find({ key: 'all' })).toBeUndefined()
    const other = await mount($, REPLY, 'reply-other')
    await pressLink(other, 'all', '▸ open all')
    await one.advance(100)
    await other.advance(100)
    expect((await rowsOf(one)).join('\n')).toBe('The fix is small.')
    expect(await footer(other)).toBe('« close all  3 of 3 open')
    await one.unmount()
    await other.unmount()
  })

  test('the footer is drawn only where clicks land', async $ => {
    const main = await $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
      requestId: 'reply-main',
      viewport: { ...FULLSCREEN, isFullscreen: false },
    })
    expect(await main.find({ key: 'all' })).toBeUndefined()
    await main.unmount()
    const desktop = await mount($, REPLY, 'reply-desktop', 'desktop')
    expect(await desktop.find({ key: 'all' })).toBeUndefined()
    await desktop.unmount()
  })

  test('the links follow the count', () => {
    expect(footerLinks(0, 3)).toEqual([{ href: OPEN_ALL, label: '▸ open all' }])
    expect(footerLinks(1, 3)).toEqual([
      { href: OPEN_ALL, label: '▸ open all' },
      { href: CLOSE_ALL, label: '« close all' },
    ])
    expect(footerLinks(3, 3)).toEqual([{ href: CLOSE_ALL, label: '« close all' }])
  })

  test('neither the footer nor the tool group toggle shows an address', async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'folded'}</Text>
    })
    const ui = await mount($, REPLY)
    const row = await footer(ui)
    expect(row).toBe('▸ open all  none of 3 open')
    expect(row).not.toContain('stretch.invalid')
    expect(row).not.toContain('https')
    expect(JSON.stringify(await ui.drawn({ in: 'all' }))).not.toContain('stretch.invalid')
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()

    const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
    const group = await $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'ToolGroup', props: { calls: [call], isActive: false, isExpanded: true }, requestId: 'g-plain', viewport: FULLSCREEN })
    for (const label of ['▸ show', '▾ fold']) {
      const toggle = await linksRow(group, 'tools')
      expect(toggle).toContain(label)
      expect(toggle).not.toContain('stretch.invalid')
      expect(toggle).not.toContain('https')
      expect(JSON.stringify(await group.drawn({ in: 'tools' }))).not.toContain('stretch.invalid')
      await pressLink(group, 'tools', label)
    }
    expect(await group.find({ type: 'Markdown' })).toBeUndefined()
    await group.unmount()
  })
})

describe('a stretch that holds another ends in »', () => {
  test('hasNested sees a linkable stretch inside the long form and nothing else', () => {
    const [outer, inner] = stretches(parse(REPLY))
    expect(outer !== undefined && hasNested(outer)).toBe(true)
    expect(inner !== undefined && hasNested(inner)).toBe(false)
    // A label inside the long form is drawn open, so it is no reason for the mark.
    const [labelled] = stretches(parse('Lead {{a|the alpha\n{{Why|nested label inside}}\nmore}} end.'))
    expect(labelled !== undefined && hasNested(labelled)).toBe(false)
    const [twoDeep] = stretches(parse('Lead {{a|the alpha {{b|the beta {{c|the gamma}} end}} end}} end.'))
    expect(twoDeep !== undefined && hasNested(twoDeep)).toBe(true)
  })

  test('the mark is dim, inside the link, and gone once the stretch is open', async $ => {
    const ui = await mount($, REPLY)
    expect((await rowsOf(ui)).join('\n')).toBe('It fails on a stale cache».')
    const mark = (await runsOf(ui)).find(run => run.text === '»')
    expect(mark?.props.dimColor).toBe(true)
    expect(mark?.props.underline).toBe(true)
    // A press on the mark itself opens the stretch.
    await pressOn(ui, '»')
    const open = (await rowsOf(ui)).join('\n')
    expect(open).toContain('because the key hashes one file alone «.')
    expect(open).not.toContain('»')
    await pressOn(ui, '«')
    expect((await rowsOf(ui)).join('\n')).toBe('It fails on a stale cache».')
    await ui.unmount()
  })

  test('the mark never reaches the open text or the model', () => {
    expect(writeOpen(parse(REPLY))).toBe('It fails because the key hashes only the manifest alone.\n\nThe fix adds the lockfile to the key.')
    expect(stretches(parse(REPLY)).map(stretch => stretch.short)).toEqual(['on a stale cache', 'one file', 'is small'])
  })

  test('on desktop the link label carries the mark', async $ => {
    const ui = await mount($, REPLY, 'reply-1', 'desktop')
    const md = (await ui.find({ type: 'Markdown' }))?.text ?? ''
    expect(md).toBe(`It fails [on a stale cache»](${HREF}open/0).\n\nThe fix [is small](${HREF}open/2).`)
    await ui.unmount()
  })
})

describe('/stretch words', () => {
  test('a count set by the command reaches the guide on the next prompt, once', async ($, on) => {
    mock.store(on)
    let api: Api[] = [user('q', guide(DEFAULT_SHORT_WORDS)), assistant('Answer.')]
    const contexts = conversation(on, () => api)
    expect((await stretchCommand($, 'words 80')).text).toContain('now 80 words')
    await submit($)
    expect(contexts[0]).toEqual([guide(80)])
    api = [...api, user('next', guide(80)), assistant('Answer.')]
    await submit($)
    expect(contexts[1]).toBeUndefined()
  })

  test('words alone says the count and where it comes from', async ($, on) => {
    mock.store(on)
    expect((await stretchCommand($, 'words')).text).toBe('stretch: a short reply is 150 words at most, from the default.')
    await stretchCommand($, 'words 80')
    expect((await stretchCommand($, 'words')).text).toBe('stretch: a short reply is 80 words at most, from /stretch words.')
    expect((await stretchCommand($, '')).text).toContain('stretch is on, and a short reply is 80 words at most.')
    expect((await stretchCommand($, 'words default')).text).toContain('A short reply is 150 words at most, from the default.')
    expect((await stretchCommand($, 'words')).text).toContain('150 words at most, from the default.')
  })

  test('the /config setting is named as the source, and the command outranks it', { options: { shortWords: 60 } }, async ($, on) => {
    mock.store(on)
    const contexts = conversation(on, () => [])
    expect((await stretchCommand($, 'words')).text).toBe('stretch: a short reply is 60 words at most, from the shortWords setting in /config.')
    await stretchCommand($, 'words 90')
    await submit($)
    expect(contexts[0]).toEqual([guide(90)])
    await stretchCommand($, 'words default')
    expect((await stretchCommand($, 'words')).text).toContain('60 words at most, from the shortWords setting in /config.')
  })

  test('a count out of range or not a number changes nothing', async ($, on) => {
    mock.store(on)
    await stretchCommand($, 'words 80')
    for (const bad of ['5', '2001', 'abc', '80 words', '-10', '1e3']) {
      expect((await stretchCommand($, `words ${bad}`)).text).toBe('stretch: the word count must be a whole number from 10 to 2000. Nothing changed.')
    }
    expect((await stretchCommand($, 'words')).text).toContain('80 words at most, from /stretch words.')
  })

  test('the usage names the new word', () => {
    expect(USAGE).toContain('Usage: /stretch on | off | open-all | close-all | words N.')
    expect(USAGE).toContain('10 to 2000')
  })
})

describe('show all and fold all over tool groups', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const mountGroup = ($: Engine, requestId: string) =>
    $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [call], isActive: false, isExpanded: true },
      requestId,
      viewport: FULLSCREEN,
    })
  type Group = Awaited<ReturnType<typeof mountGroup>>
  const engineDraws = (on: On) =>
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'folded'}</Text>
    })
  const isOpen = async (ui: Group) => (await ui.find({ text: 'every call' })) !== undefined
  const toggle = (ui: Group) => linksRow(ui, 'tools')
  const LABELS = { group: '▸ show', 'groups-open': '▸ show all', 'groups-close': '▾ fold all' } as const
  // The group's own toggle reads show or fold by its state, so the row is read first and the press lands on the label drawn.
  const press = async (ui: Group, which: keyof typeof LABELS) =>
    pressLink(ui, 'tools', which === 'group' && (await toggle(ui)).startsWith('▾') ? '▾ fold' : LABELS[which])

  test('show all opens every group, a group folds alone, fold all folds them, and a group opens alone', async ($, on) => {
    engineDraws(on)
    const one = await mountGroup($, 'group-1')
    const two = await mountGroup($, 'group-2')
    expect(await isOpen(one)).toBe(false)
    expect(await toggle(one)).toBe('▸ show · ▸ show all')

    await press(one, 'groups-open')
    expect(await isOpen(one)).toBe(true)
    expect(await isOpen(two)).toBe(true)
    expect(await toggle(two)).toBe('▾ fold · ▾ fold all')

    await press(one, 'group')
    expect(await isOpen(one)).toBe(false)
    expect(await isOpen(two)).toBe(true)

    await press(two, 'groups-close')
    expect(await isOpen(one)).toBe(false)
    expect(await isOpen(two)).toBe(false)

    await press(two, 'group')
    expect(await isOpen(one)).toBe(false)
    expect(await isOpen(two)).toBe(true)

    // A later show all takes a group folded by its own toggle along with the rest.
    await press(one, 'groups-open')
    expect(await isOpen(one)).toBe(true)
    expect(await isOpen(two)).toBe(true)
    await one.unmount()
    await two.unmount()
  })
})
