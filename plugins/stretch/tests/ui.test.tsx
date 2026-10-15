import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { widthOf } from '../hooks/layout'

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key.}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }
const HREF = 'https://stretch.invalid/'
const FIRST = 'paragraph-0'
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], outputStyle: null, traits: [] } as const

const mountReply = ($: Engine, viewport: typeof FULLSCREEN | undefined, text = REPLY, requestId = 'reply-1') =>
  $.ui.mount({
    plugin: 'stretch',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    ...(viewport !== undefined && { viewport }),
  })
type Mounted = Awaited<ReturnType<typeof mountReply>>

const shown = async (ui: Mounted) => (await ui.find({ type: 'Markdown' }))?.text ?? ''
const hasNote = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).some(piece => piece.text?.includes('/tui fullscreen') === true)

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
const pressOn = async (ui: Mounted, phrase: string, { key = FIRST, last = false } = {}) => {
  const rows = await rowsOf(ui, key)
  const y = last ? rows.findLastIndex(row => row.includes(phrase)) : rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const row = rows[y] ?? ''
  const x = widthOf(row.slice(0, last ? row.lastIndexOf(phrase) : row.indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}

test('in the fullscreen terminal a click expands a stretch in place and « collapses it', async $ => {
  const ui = await mountReply($, FULLSCREEN)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
  expect(await hasNote(ui)).toBe(false)
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  expect(await textIn(ui)).toContain('because the cache key hashes only package.json, set in one file «.')
  await pressOn(ui, '«', { last: true })
  await ui.advance(2000)
  expect(await textIn(ui)).toBe('The build fails on a stale cache.\nBraces in code stay: {{a|b}}.')
  await ui.unmount()
})

describe('open-all fallback', () => {
  test('on the main screen every stretch is drawn open and the first reply carries the note, once', async $ => {
    const ui = await mountReply($, MAIN_SCREEN)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await shown(ui)).toContain('because the cache key hashes only `package.json`, set in `ci/cache.ts`.')
    expect(await shown(ui)).toContain('Braces in code stay: `{{a|b}}`.')
    expect(await shown(ui)).not.toContain('{{on a stale cache')
    expect(await hasNote(ui)).toBe(true)
    await ui.unmount()

    const later = await mountReply($, MAIN_SCREEN, REPLY, 'reply-2')
    expect(await hasNote(later)).toBe(false)
    await later.unmount()
  })

  test('a terminal whose viewport is unknown also draws open and says why', async $ => {
    const ui = await mountReply($, undefined)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect(await shown(ui)).toContain('Add the lockfile to the key.')
    expect(await hasNote(ui)).toBe(true)
    await ui.unmount()
  })

  test('the phone app draws open with no /tui note', async $ => {
    const ui = await $.ui.mount({
      plugin: 'stretch',
      surface: 'mobile',
      component: 'AssistantMessage',
      props: { text: REPLY, isFirstOfReply: true },
      requestId: 'reply-1',
      viewport: MAIN_SCREEN,
    })
    expect((await ui.findAll({ type: 'Text' })).some(piece => piece.text?.includes('/tui') === true)).toBe(false)
    await ui.unmount()
  })
})

test('a reply without a stretch is left to the engine', async ($, on) => {
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const ui = await mountReply($, FULLSCREEN, 'Plain answer.')
  expect(await ui.find({ text: 'engine' })).toBeDefined()
  await ui.unmount()
})

test('the system prompt carries the guide while something draws', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
  const drawn = await $.prompt.compose({ ...COMPOSE, surfaces: ['terminal'] })
  const guide = drawn.sections.at(-1)
  expect(guide?.id).toBe('stretch:guide')
  expect(guide?.text).toContain('150 words')
  expect(guide?.text).toContain('commit message')
  const headless = await $.prompt.compose({ ...COMPOSE, surfaces: [] })
  expect(headless.sections.some(s => s.id === 'stretch:guide')).toBe(false)
})

test('the next prompt says which stretches were opened and which were not', async ($, on) => {
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'why does CI fail?', toolUses: [] },
      { role: 'assistant', text: REPLY, toolUses: [] },
    ],
  }))
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text, context: e.context }
  })

  const ui = await mountReply($, FULLSCREEN)
  await pressOn(ui, 'on a stale cache')
  await ui.advance(2000)
  await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
  expect(context).toEqual([
    'Stretch: in your last reply the reader opened "on a stale cache". They did not open ", set in one file", "The fix is one line.".',
  ])

  // The opened list resets with each prompt.
  await $.prompt.submit({ text: 'and?', wait: false, origin: { kind: 'composer' } })
  expect(context?.[0]).toMatch(/^Stretch: in your last reply the reader opened none of "on a stale cache", ", set in one file", "The fix is one line."\./)
  await ui.unmount()
})

describe('tool groups', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const mountGroup = ($: Engine, props: { isActive: boolean; isErrored: boolean }) =>
    $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'ToolGroup',
      props: { calls: [{ ...call, isErrored: props.isErrored }], isActive: props.isActive, isExpanded: true },
      requestId: 'group-1',
      viewport: FULLSCREEN,
    })
  const engineDraws = (on: On) =>
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'Ran 1 shell command'}</Text>
    })

  test('a finished group folds to one line and a click unfolds and folds it', async ($, on) => {
    engineDraws(on)
    const ui = await mountGroup($, { isActive: false, isErrored: false })
    expect(await ui.find({ text: 'Ran 1 shell command' })).toBeDefined()
    expect((await ui.find({ key: 'tools' }))?.text).toContain('▸ show')
    await ui.press({ key: 'tools', link: { href: HREF } })
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    await ui.press({ key: 'tools', link: { href: HREF } })
    expect(await ui.find({ text: 'Ran 1 shell command' })).toBeDefined()
    await ui.unmount()
  })

  test('an errored or running group stays open as the engine draws it', async ($, on) => {
    engineDraws(on)
    for (const props of [
      { isActive: false, isErrored: true },
      { isActive: true, isErrored: false },
    ]) {
      const ui = await mountGroup($, props)
      expect(await ui.find({ text: 'every call' })).toBeDefined()
      expect(await ui.find({ key: 'tools' })).toBeUndefined()
      await ui.unmount()
    }
  })
})
