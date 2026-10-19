import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SHORT_WORDS, guide } from '../hooks/guide'
import { dim, layout, link, tint, widthOf } from '../hooks/layout'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const HREF = 'https://stretch.invalid/'
const OPEN_ALL = `${HREF}open-all`
const CLOSE_ALL = `${HREF}close-all`

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
const pressAt = async (ui: Mounted, x: number, y: number, key = 'paragraph-0') => {
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
  await ui.advance(2000)
}
const pressOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  await pressAt(ui, widthOf((rows[y] ?? '').slice(0, (rows[y] ?? '').indexOf(phrase))), y, key)
}
const count = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).find(piece => piece.props?.dimColor === true && /of \d+ open$/.test(piece.text ?? ''))?.text

describe('the » mark stays with its link', () => {
  test('a row never starts with the » or the full stop that touches it', () => {
    const line = `It fails ${link('open', '0', `on a stale cache${dim('»')}`)}. More words follow here to wrap.`
    for (let w = 10; w <= 60; w++) {
      const rows = layout(line, w).map(row => row.map(run => run.text).join(''))
      for (const row of rows) {
        expect(widthOf(row)).toBeLessThanOrEqual(w)
        expect(/^[».]/.test(row)).toBe(false)
      }
      expect(rows.join(' ')).toBe('It fails on a stale cache». More words follow here to wrap.')
    }
  })

  test('in a narrow region the mark wraps with its word and a press on it still opens', async $ => {
    const ui = await mount($, 'It fails {{on a stale cache|because the key hashes {{one file|only the manifest}} alone}}. More.')
    await ui.resize({ columns: 25, rows: 40, in: 'paragraph-0' })
    const rows = await rowsOf(ui)
    expect(rows).toEqual(['It fails on a stale', 'cache». More.'])
    await pressAt(ui, 5, 1)
    expect((await rowsOf(ui)).join(' ')).toContain('because the key hashes one file alone «')
    await ui.unmount()
  })

  test('noncharacters in the reply never draw and never style a neighbour', async $ => {
    const text = 'Lead \ufdd5dim?\ufdd6 and {{x|alpha {{y|beta end}} tail}} done \ufdd3#ff0000\ufdd1red\ufdd4.'
    const ui = await mount($, text)
    const tree = JSON.stringify(await ui.drawn({ in: 'paragraph-0' }))
    expect(/[\ufdd0-\ufdef]/.test(tree)).toBe(false)
    expect(tree).not.toContain('#ff0000"')
    expect((await rowsOf(ui)).join('\n')).toBe('Lead dim? and x» done #ff0000red.')
    await ui.unmount()
  })

  test('a » inside an open parent keeps every run in order, and the count follows nested opens', async $ => {
    const ui = await mount($, 'A {{x|alpha {{y|beta {{z|gamma deep}} end}} tail}} done.')
    expect(await count(ui)).toBe('none of 3 open')
    await pressOn(ui, 'x')
    expect((await rowsOf(ui)).join('\n')).toBe('A alpha y» tail « done.')
    await pressOn(ui, 'y»')
    expect((await rowsOf(ui)).join('\n')).toBe('A alpha beta z end « tail « done.')
    expect(await count(ui)).toBe('2 of 3 open')
    await pressOn(ui, 'z')
    expect(await count(ui)).toBe('3 of 3 open')
    // Closing the outer stretch closes the two inside it as well.
    const rows = await rowsOf(ui)
    const last = rows[0] ?? ''
    await pressAt(ui, widthOf(last.slice(0, last.lastIndexOf('«'))), 0)
    expect((await rowsOf(ui)).join('\n')).toBe('A x» done.')
    expect(await count(ui)).toBe('none of 3 open')
    await ui.unmount()
  })

  test('a short form ending in a code span or a link takes the mark, and only the mark cell opens it', async $ => {
    const text = 'Run {{`npm ci`|the `npm ci` step, which {{reads lockfile|reads the lockfile only}} now}} and more.'
    const ui = await mount($, text)
    const rows = await rowsOf(ui)
    expect(rows).toEqual(['Run npm ci» and more.'])
    const x = widthOf('Run npm ci')
    await pressAt(ui, x + 1, 0)
    expect(await rowsOf(ui)).toEqual(['Run npm ci» and more.'])
    await pressAt(ui, x, 0)
    expect((await rowsOf(ui)).join(' ')).toContain('the npm ci step, which reads lockfile now «')
    await ui.unmount()
    const desktop = await mount($, 'See {{[docs](https://x.io/a)|the [docs](https://x.io/a) page {{p|the page itself}} here}} and {{q|more words here}}.', 'r2', 'desktop')
    expect((await desktop.find({ type: 'Markdown' }))?.text).toBe(`See [docs (https://x.io/a)»](${HREF}open/0) and [q](${HREF}open/2).`)
    await desktop.unmount()
  })
})

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

describe('where the footer is drawn', () => {
  test('the footer counts one block of text, so two blocks of one stretch each get none', async $ => {
    const a = await mount($, 'First {{x|alpha long one}} here.', 'req-a')
    const b = await mount($, 'Second {{y|beta long one}} here.', 'req-b')
    expect(await a.find({ key: 'all' })).toBeUndefined()
    expect(await b.find({ key: 'all' })).toBeUndefined()
    await a.unmount()
    await b.unmount()
  })
})

describe('/stretch words at its edges', () => {
  const BAD = 'stretch: the word count must be a whole number from 10 to 2000. Nothing changed.'
  test('the bounds are taken, anything else is refused, and spacing does not matter', async ($, on) => {
    mock.store(on)
    for (const good of ['words 10', 'words 2000', 'words  80 ', 'WORDS 80', 'words 080']) expect((await stretchCommand($, good)).text).toContain('now ')
    for (const bad of ['words 9', 'words 2001', 'words 1e2', 'words 80.5', 'words -80', 'words +80', 'words 0x50', 'words 80 90']) expect((await stretchCommand($, bad)).text).toBe(BAD)
    expect((await stretchCommand($, 'words')).text).toBe('stretch: a short reply is 80 words at most, from /stretch words.')
  })

  test('a stored value that is not a count falls back to the setting', { options: { shortWords: 60 } }, async ($, on) => {
    mock.store(on, { shortWords: 'abc' })
    const contexts = conversation(on, () => [user('q', guide(60)), assistant('Answer.')])
    expect((await stretchCommand($, 'words')).text).toBe('stretch: a short reply is 60 words at most, from the shortWords setting in /config.')
    await submit($)
    expect(contexts[0]).toBeUndefined()
  })

  test('with stretch off the count is kept but no guide is sent', async ($, on) => {
    mock.store(on)
    let api: Api[] = [user('q', guide(DEFAULT_SHORT_WORDS)), assistant('Answer.')]
    const contexts = conversation(on, () => api)
    await stretchCommand($, 'off')
    expect((await stretchCommand($, 'words 80')).text).toContain('now 80 words')
    await submit($)
    expect(contexts[0]?.some(line => line.includes('# Expandable phrases in chat replies'))).toBe(false)
    api = [...api, user('next', contexts[0]?.[0] ?? ''), assistant('Plain.')]
    await stretchCommand($, 'on')
    await submit($)
    expect(contexts[1]).toEqual([guide(80)])
  })
})

describe('tool groups after a bulk', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const mountGroup = ($: Engine, requestId: string, over: Partial<typeof call> = {}) =>
    $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [{ ...call, ...over }], isActive: false, isExpanded: true },
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
  const press = (ui: Group, which: string) => ui.press({ key: 'tools', link: { href: HREF + which } })

  test('own toggle, fold all, own toggle again, a late group, and groups that never fold', async ($, on) => {
    engineDraws(on)
    const one = await mountGroup($, 'g1')
    await press(one, 'group')
    expect(await isOpen(one)).toBe(true)
    await press(one, 'groups-close')
    expect(await isOpen(one)).toBe(false)
    await press(one, 'group')
    expect(await isOpen(one)).toBe(true)
    await press(one, 'groups-open')
    const late = await mountGroup($, 'g-late')
    expect(await isOpen(late)).toBe(true)
    await press(one, 'groups-close')
    for (const over of [{ isErrored: true }, { isRunning: true }, { isInterrupted: true }]) {
      const stays = await mountGroup($, `g-${Object.keys(over)[0]}`, over)
      expect(await isOpen(stays)).toBe(true)
      expect(await stays.find({ key: 'tools' })).toBeUndefined()
    }
  })

  test('foldTools off draws no group links at all', { options: { foldTools: false } }, async ($, on) => {
    engineDraws(on)
    const one = await mountGroup($, 'g1')
    expect(await isOpen(one)).toBe(true)
    expect(await one.find({ key: 'tools' })).toBeUndefined()
  })
})
