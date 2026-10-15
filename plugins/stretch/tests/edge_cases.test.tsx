import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { widthOf } from '../hooks/layout'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const MAIN_SCREEN = { columns: 100, rows: 40, isFullscreen: false }

const mount = ($: Engine, viewport: typeof FULLSCREEN | undefined, text: string, requestId = 'reply-1', surface: 'terminal' | 'desktop' = 'terminal') =>
  $.ui.mount({
    plugin: 'stretch',
    surface,
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId,
    ...(viewport !== undefined && { viewport }),
  })
type Mounted = Awaited<ReturnType<typeof mount>>

/** Stands in for the engine: draws the text it is handed as one Markdown. */
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
const allText = async (ui: Mounted) => {
  const md = (await ui.findAll({ type: 'Markdown' })).map(m => m.text ?? '').join('\n')
  let client = ''
  for (let i = 0; i < 6; i++) {
    try {
      client += (await rowsOf(ui, `paragraph-${i}`)).join('\n') + '\n'
    } catch {
      // no such paragraph
    }
  }
  return `${md}\n${client}`
}
const pressOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const x = widthOf((rows[y] ?? '').slice(0, (rows[y] ?? '').indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}

describe('nothing is lost in the fullscreen terminal', () => {
  test('a stray {{ before a table leaves the table and the rest of the reply', async ($, on) => {
    engine(on)
    const text = 'Handlebars opens with {{ and that is all.\n\n| col | val |\n|---|---|\n| a | 1 |\n\nLast line.'
    const ui = await mount($, FULLSCREEN, text)
    const shown = await allText(ui)
    expect(shown).toContain('Last line.')
    expect(shown).toContain('col')
    expect(shown).toContain('opens with {{ and')
    await ui.unmount()
  })

  test('a {{ that never closes stays literal, and a later stretch still works', async $ => {
    const ui = await mount($, FULLSCREEN, 'Open {{ here and {{unclosed|text then {{b|the bee}} end.')
    const rows = (await rowsOf(ui)).join('\n')
    expect(rows).toBe('Open {{ here and {{unclosed|text then b end.')
    await pressOn(ui, 'b end')
    await ui.advance(2000)
    expect((await rowsOf(ui)).join('\n')).toContain('the bee «')
    await ui.unmount()
  })

  test('an empty short form draws its long form as plain text', async ($, on) => {
    engine(on)
    const ui = await mount($, FULLSCREEN, 'See {{|the hidden detail}} here.')
    expect(await allText(ui)).toContain('See the hidden detail here.')
    await ui.unmount()
  })

  test('an empty short or long form beside a real stretch draws as plain text in the Client', async $ => {
    const ui = await mount($, FULLSCREEN, 'A {{|plain long}} and {{kept short|}} and {{b|the bee}}.')
    expect((await rowsOf(ui)).join('\n')).toBe('A plain long and kept short and b.')
    await ui.unmount()
  })

  test('CRLF replies leave no carriage returns in the drawn rows', async $ => {
    const ui = await mount($, FULLSCREEN, 'Line one {{a|alpha long}} end.\r\nSecond line here.\r\n')
    const rows = await rowsOf(ui)
    expect(rows.some(r => r.includes('\r'))).toBe(false)
    expect(rows.join('\n')).toContain('Second line here.')
    await ui.unmount()
  })

  test('a CRLF heading in a stretch paragraph is drawn without its hashes', async $ => {
    const ui = await mount($, FULLSCREEN, '## Title\r\nBody {{a|alpha long}} end.')
    const rows = await rowsOf(ui)
    expect(rows[0]).toBe('Title')
    await ui.unmount()
  })
})

describe('nothing is lost in the open-all fallback', () => {
  test('an empty long form keeps the short form as plain text', async ($, on) => {
    engine(on)
    const ui = await mount($, MAIN_SCREEN, 'See {{the detail|}} here.')
    expect(await allText(ui)).toContain('See the detail here.')
    await ui.unmount()
  })

  test('Jinja and Actions braces draw verbatim', async ($, on) => {
    engine(on)
    for (const viewport of [MAIN_SCREEN, FULLSCREEN]) {
      const ui = await mount($, viewport, 'Jinja prints {{ name }} and Actions reads ${{ secrets.TOKEN }}.')
      const shown = await allText(ui)
      expect(shown).toContain('{{ name }}')
      expect(shown).toContain('${{ secrets.TOKEN }}')
      await ui.unmount()
    }
  })

  test('a Jinja filter is never a stretch', async ($, on) => {
    engine(on)
    const ui = await mount($, MAIN_SCREEN, 'Jinja writes {{ name | upper }} to uppercase it, and {{a|the alpha}} opens.')
    const shown = await allText(ui)
    expect(shown).toContain('{{ name | upper }}')
    expect(shown).toContain('and the alpha opens')
    await ui.unmount()
  })

  test('an unmatched backtick is literal and later stretches still resolve', async $ => {
    const ui = await mount($, MAIN_SCREEN, 'Press the ` key first.\n\nThen {{x|the long x}} works.')
    const shown = await allText(ui)
    expect(shown).not.toContain('{{x|the long x}}')
    expect(shown).toContain('Then the long x works.')
    await ui.unmount()
  })
})

describe('desktop links', () => {
  test('an empty short form is plain long text, never an empty link', async ($, on) => {
    engine(on)
    const ui = await mount($, undefined, 'See {{|the hidden detail}} here.', 'reply-1', 'desktop')
    const md = (await ui.find({ type: 'Markdown' }))?.text ?? ''
    expect(md).not.toMatch(/\[\]\(/)
    expect(md).toBe('See the hidden detail here.')
    await ui.unmount()
  })

  test('empty forms beside a real stretch draw as plain text', async $ => {
    const ui = await mount($, undefined, 'A {{|plain long}} and {{kept short|}} and {{b|the bee}}.', 'reply-1', 'desktop')
    const md = (await ui.find({ type: 'Markdown' }))?.text ?? ''
    expect(md).toBe('A plain long and kept short and [b](https://stretch.invalid/open/0).')
    await ui.unmount()
  })
})

describe('next-prompt context', () => {
  const A = 'Reply A says {{alpha|the alpha detail}}.'
  const B = 'Reply B says {{beta|the beta detail}}.'

  test('an open in an older reply is not reported for the latest one', async ($, on) => {
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'q1', toolUses: [] },
        { role: 'assistant', text: A, toolUses: [] },
        { role: 'user', text: 'q2', toolUses: [] },
        { role: 'assistant', text: B, toolUses: [] },
      ],
    }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    const a = await mount($, FULLSCREEN, A, 'reply-A')
    const b = await mount($, FULLSCREEN, B, 'reply-B')
    await pressOn(a, 'alpha')
    await a.advance(2000)
    await $.prompt.submit({ text: 'next', wait: false, origin: { kind: 'composer' } })
    expect(context?.[0] ?? '').not.toContain('"alpha"')
    expect(context?.[0] ?? '').toContain('none of "beta"')
    await a.unmount()
    await b.unmount()
  })

  test('opens are cleared by a non-composer prompt, which gets no context line', async ($, on) => {
    let messages = [
      { role: 'user' as const, text: 'q1', toolUses: [] },
      { role: 'assistant' as const, text: A, toolUses: [] },
    ]
    on('session.messages', () => ({ value: messages }))
    const seenContexts: (readonly string[] | undefined)[] = []
    on('prompt.submit', ($, e) => {
      seenContexts.push(e.context)
      return { text: e.text, context: e.context }
    })
    const a = await mount($, FULLSCREEN, A, 'reply-A')
    await pressOn(a, 'alpha')
    await a.advance(2000)
    await $.prompt.submit({ text: '<task-notification>done</task-notification>', wait: false, origin: { kind: 'task-notification' } as never })
    messages = [...messages, { role: 'user', text: '<task-notification>done</task-notification>', toolUses: [] }, { role: 'assistant', text: B, toolUses: [] }]
    await $.prompt.submit({ text: 'and now?', wait: false, origin: { kind: 'composer' } })
    expect(seenContexts[0]).toBeUndefined()
    expect(seenContexts[1]?.[0] ?? '').not.toContain('"alpha"')
    await a.unmount()
  })

  test('a repeated short form is listed once', async ($, on) => {
    const R = 'It {{works|works on Linux}} and {{works|works on Mac}}.'
    on('session.messages', () => ({ value: [{ role: 'user', text: 'q', toolUses: [] }, { role: 'assistant', text: R, toolUses: [] }] }))
    let context: readonly string[] | undefined
    on('prompt.submit', ($, e) => {
      context = e.context
      return { text: e.text, context: e.context }
    })
    await $.prompt.submit({ text: 'ok', wait: false, origin: { kind: 'composer' } })
    expect(context?.[0] ?? '').not.toContain('"works", "works"')
    expect(context?.[0] ?? '').toContain('none of "works".')
  })
})

describe('tool group fold', () => {
  const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
  const groupWith = ($: Engine, calls: (typeof call)[], isActive = false) =>
    $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive, isExpanded: true }, requestId: 'g', viewport: FULLSCREEN })
  const engineGroup = (on: On) =>
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'folded'}</Text>
    })

  test('one errored call among many keeps the group open', async ($, on) => {
    engineGroup(on)
    const calls = [call, call, { ...call, isErrored: true }, call].map((c, i) => ({ ...c, tool_use_id: `t${i}` }))
    const ui = await groupWith($, calls)
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    await ui.unmount()
  })

  test('a call still running in an inactive group keeps it open', async ($, on) => {
    engineGroup(on)
    const ui = await groupWith($, [call, { ...call, tool_use_id: 't2', isRunning: true }])
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    await ui.unmount()
  })

  test('an interrupted call keeps the group open', async ($, on) => {
    engineGroup(on)
    const ui = await groupWith($, [{ ...call, isInterrupted: true }])
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    await ui.unmount()
  })
})

describe('fullscreen note', () => {
  test('only the first block of a reply carries the note', async $ => {
    const has = async (ui: Mounted) => (await ui.findAll({ type: 'Text' })).some(t => t.text?.includes('/tui fullscreen') === true)
    const one = await mount($, MAIN_SCREEN, 'First {{a|the alpha}}.', 'msg-1')
    expect(await has(one)).toBe(true)
    await one.unmount()
    const two = await $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: 'Second {{b|the beta}}.', isFirstOfReply: false },
      requestId: 'msg-1',
      viewport: MAIN_SCREEN,
    })
    expect(await has(two as unknown as Mounted)).toBe(false)
    await two.unmount()
  })
})
