import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SHORT_WORDS, guide, GUIDE_TITLE, OFF_NOTE, settingsOf } from '../hooks/guide'
import { widthOf } from '../hooks/layout'
import { isLinkable, parse, stretches, writeOpen } from '../hooks/parse'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', tools: [], outputStyle: null, traits: [] } as const
const REPLY = 'The build fails {{on a stale cache|because the cache key hashes only the manifest}} and {{the fix is small|adding the lockfile to the key fixes it}}.'

type Api = { role: 'user' | 'assistant'; content: { type: string; text?: string }[] }
const user = (...texts: string[]): Api => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const assistant = (text: string): Api => ({ role: 'assistant', content: [{ type: 'text', text }] })

/**
 * Stands in for the engine's conversation: the API form from `api()`, the rows from `rows()`, and
 * the context of every prompt kept in `contexts`.
 */
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

const mount = ($: Engine, text: string, requestId = 'reply-1') =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId, viewport: FULLSCREEN })
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
const pressOn = async (ui: Mounted, phrase: string, key = 'paragraph-0') => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const x = widthOf((rows[y] ?? '').slice(0, (rows[y] ?? '').indexOf(phrase)))
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}

describe('the guide rides on the prompt', () => {
  test('the first prompt of a conversation carries the guide, once', async ($, on) => {
    let api: Api[] = []
    const contexts = conversation(on, () => api)
    await submit($, 'first')
    expect(contexts[0]).toEqual([guide(DEFAULT_SHORT_WORDS)])
    // The engine keeps the context beside the prompt, so the next request already holds the guide.
    api = [user('first', guide(DEFAULT_SHORT_WORDS)), assistant('Plain answer.')]
    await submit($, 'second')
    expect(contexts[1]).toBeUndefined()
  })

  test('after a compaction or a /clear the guide comes back', async ($, on) => {
    let api: Api[] = [user('first', guide(DEFAULT_SHORT_WORDS)), assistant('Plain answer.')]
    const contexts = conversation(on, () => api)
    await submit($)
    expect(contexts[0]).toBeUndefined()
    // A compaction leaves its summary in place of what it replaced; a /clear leaves nothing.
    api = [user('Summary of the conversation so far.'), assistant('Noted.')]
    await submit($)
    expect(contexts[1]).toEqual([guide(DEFAULT_SHORT_WORDS)])
    api = []
    await submit($)
    expect(contexts[2]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('a resumed conversation that holds the guide does not get another copy', async ($, on) => {
    const contexts = conversation(on, () => [user('old', `<system-reminder>\n${guide(DEFAULT_SHORT_WORDS)}\n</system-reminder>`), assistant('Old answer.')])
    await submit($)
    expect(contexts[0]).toBeUndefined()
  })

  test('the guide never reaches the system prompt, so it cannot appear twice', async ($, on) => {
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' }] }))
    const drawn = await $.prompt.compose({ ...COMPOSE, surfaces: ['terminal'] })
    expect(drawn.sections.some(section => section.text.includes(GUIDE_TITLE))).toBe(false)
  })

  test('only what a person sends gets the guide', async ($, on) => {
    const contexts = conversation(on, () => [])
    for (const kind of ['sdk', 'task-notification', 'scheduled-trigger', 'peer'] as const) {
      await $.prompt.submit({ text: 'from elsewhere', wait: false, origin: { kind } })
    }
    expect(contexts).toEqual([undefined, undefined, undefined, undefined])
    await $.prompt.submit({ text: 'from the phone', wait: false, origin: { kind: 'bridge' } })
    expect(contexts[4]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('a command that sends a prompt gets the guide', async ($, on) => {
    const contexts = conversation(on, () => [])
    await $.prompt.submit({ text: '/work 123', wait: false, origin: { kind: 'composer' }, command: { name: 'work', args: '123' } } as never)
    expect(contexts[0]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('a prompt that quotes the guide title is no copy of the guide', async ($, on) => {
    const contexts = conversation(on, () => [user(`Why does ${GUIDE_TITLE} keep coming up?`), assistant('Answer.')])
    await submit($)
    expect(contexts[0]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('a compaction summary that mentions the guide brings it back all the same', async ($, on) => {
    const summary = `This session is being continued from a previous conversation. The plugin's "${GUIDE_TITLE}" guide asked for replies in 150 words or fewer, with {{short|long}} markup.`
    const contexts = conversation(on, () => [user(summary), assistant('Understood.')])
    await submit($)
    expect(contexts[0]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('a guide the engine merged into a block with other context is found', async ($, on) => {
    const merged = `<system-reminder>\nother notes\n</system-reminder>\n\nprompt.submit hook additional context: ${guide(DEFAULT_SHORT_WORDS)}`
    const contexts = conversation(on, () => [user('first', merged), assistant('Answer.')])
    await submit($)
    expect(contexts[0]).toBeUndefined()
  })

  test('the /stretch command line itself carries no guide', async ($, on) => {
    const contexts = conversation(on, () => [])
    await $.prompt.submit({ text: '/stretch', wait: false, origin: { kind: 'composer' }, command: { name: 'stretch', args: '' } } as never)
    expect(contexts[0]).toBeUndefined()
  })

  test('a conversation the hook cannot read gets nothing rather than a guess', async ($, on) => {
    const contexts = conversation(on, () => [{ role: 'user', text: 'rows, not the API form' }] as never)
    await submit($)
    expect(contexts[0]).toBeUndefined()
  })
})

describe('/stretch on and off', () => {
  test('off sends the off note once and stops the guide; on brings the guide back', async ($, on) => {
    mock.store(on)
    let api: Api[] = [user('first', guide(DEFAULT_SHORT_WORDS)), assistant('Answer.')]
    const contexts = conversation(on, () => api)
    expect((await stretchCommand($, 'off')).text).toContain('stretch is off')
    await submit($)
    expect(contexts[0]).toEqual([OFF_NOTE])
    api = [...api, user('next', OFF_NOTE), assistant('Plain.')]
    await submit($)
    expect(contexts[1]).toBeUndefined()
    // A conversation cleared while off starts without the markup.
    api = []
    await submit($)
    expect(contexts[2]).toBeUndefined()

    api = [user('next', OFF_NOTE), assistant('Plain.')]
    expect((await stretchCommand($, 'on')).text).toContain('stretch is on')
    await submit($)
    expect(contexts[3]).toEqual([guide(DEFAULT_SHORT_WORDS)])
  })

  test('the setting is kept in the store, so it outlasts the session', async ($, on) => {
    // A store that already says off, as a later session finds it.
    mock.store(on, { enabled: false })
    const contexts = conversation(on, () => [user('q', guide(DEFAULT_SHORT_WORDS)), assistant('Answer.')])
    expect((await stretchCommand($, '')).text).toContain('stretch is off')
    await submit($)
    expect(contexts[0]).toEqual([OFF_NOTE])
    await stretchCommand($, 'on')
    expect((await stretchCommand($, '')).text).toContain('stretch is on')
  })

  test('no argument prints the state and the usage; an unknown one says so', async ($, on) => {
    mock.store(on)
    const plain = (await stretchCommand($, '')).text ?? ''
    expect(plain).toContain('stretch is on')
    expect(plain).toContain('Usage: /stretch on | off | open-all | close-all')
    expect((await stretchCommand($, 'sideways')).text).toContain('"sideways" is not a /stretch option')
  })

  test('while off, the next prompt carries no report of opens', async ($, on) => {
    mock.store(on)
    const contexts = conversation(
      on,
      () => [user('q', OFF_NOTE), assistant(REPLY)],
      () => [
        { role: 'user', text: 'q', toolUses: [] },
        { role: 'assistant', text: REPLY, toolUses: [] },
      ],
    )
    await stretchCommand($, 'off')
    await submit($)
    expect(contexts[0]).toBeUndefined()
  })
})

describe('/stretch open-all and close-all', () => {
  test('open-all opens every stretch in the latest reply, and they count as opened', async ($, on) => {
    const contexts = conversation(
      on,
      () => [user('q', guide(DEFAULT_SHORT_WORDS)), assistant(REPLY)],
      () => [
        { role: 'user', text: 'q', toolUses: [] },
        { role: 'assistant', text: REPLY, toolUses: [] },
      ],
    )
    const ui = await mount($, REPLY)
    expect((await rowsOf(ui)).join('\n')).toBe('The build fails on a stale cache and the fix is small.')
    expect((await stretchCommand($, 'open-all')).text).toBe('Opened every stretch in the latest reply.')
    await ui.advance(100)
    const opened = (await rowsOf(ui)).join(' ')
    expect(opened).toContain('because the cache key hashes only the manifest')
    expect(opened).toContain('adding the lockfile to the key fixes it')

    await submit($)
    expect(contexts[0]).toEqual(['Stretch: in your last reply the reader opened "on a stale cache", "the fix is small".'])
    await ui.unmount()
  })

  test('close-all closes them again, and a later press still works', async ($, on) => {
    conversation(on, () => [])
    const ui = await mount($, REPLY)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    expect((await rowsOf(ui)).join(' ')).toContain('hashes only the manifest')
    await stretchCommand($, 'close-all')
    await ui.advance(100)
    expect((await rowsOf(ui)).join('\n')).toBe('The build fails on a stale cache and the fix is small.')
    await pressOn(ui, 'the fix is small')
    await ui.advance(2000)
    expect((await rowsOf(ui)).join(' ')).toContain('adding the lockfile to the key fixes it')
    await ui.unmount()
  })

  test('open-all leaves a reply from before the last prompt alone', async ($, on) => {
    conversation(on, () => [])
    const old = await mount($, REPLY, 'reply-old')
    await submit($)
    expect((await stretchCommand($, 'open-all')).text).toContain('no reply with clickable stretches')
    await old.advance(100)
    expect((await rowsOf(old)).join('\n')).toBe('The build fails on a stale cache and the fix is small.')
    await old.unmount()
  })
})

describe('settings', () => {
  test('missing or invalid values fall back to the defaults', () => {
    expect(settingsOf(undefined)).toEqual({ shortWords: 150, foldTools: true })
    expect(settingsOf({})).toEqual({ shortWords: 150, foldTools: true })
    for (const shortWords of [-5, 0, 3, 1e9, Number.NaN, 'many', '', true]) {
      expect(settingsOf({ shortWords }).shortWords).toBe(150)
    }
    expect(settingsOf({ foldTools: 'no' }).foldTools).toBe(true)
    expect(settingsOf({ shortWords: 80, foldTools: false })).toEqual({ shortWords: 80, foldTools: false })
    expect(settingsOf({ shortWords: '200' }).shortWords).toBe(200)
  })

  test('the guide states the word count it is given', () => {
    expect(guide(80)).toContain('in 80 words or fewer')
    expect(guide(80)).not.toContain('150')
  })

  test('shortWords sets the number in the guide the prompt carries', { options: { shortWords: 60 } }, async ($, on) => {
    const contexts = conversation(on, () => [])
    await submit($)
    expect(contexts[0]?.[0]).toContain('in 60 words or fewer')
  })

  test('a changed shortWords sends the guide again with the new number', { options: { shortWords: 90 } }, async ($, on) => {
    const contexts = conversation(on, () => [user('q', guide(150)), assistant('Answer.')])
    await submit($)
    expect(contexts[0]).toEqual([guide(90)])
  })

  test('foldTools off leaves finished tool groups as the engine draws them', { options: { foldTools: false } }, async ($, on) => {
    on('ui.render', { component: 'ToolGroup' }, ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{e.props.isExpanded ? 'every call' : 'folded'}</Text>
    })
    const call = { tool_use_id: 'toolu_1', tool: 'Bash', input: {}, isRunning: false, isErrored: false, isInterrupted: false }
    const ui = await $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'ToolGroup', props: { calls: [call], isActive: false, isExpanded: true }, requestId: 'g', viewport: FULLSCREEN })
    expect(await ui.find({ text: 'every call' })).toBeDefined()
    expect(await ui.find({ key: 'tools' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('stretches used as section labels are drawn open', () => {
  const linkable = (text: string) => stretches(parse(text)).filter(isLinkable).map(s => s.short)

  test('a short form alone on its line, or a paragraph of its own, is a label', () => {
    expect(linkable('{{Why|The cache key misses the lockfile.}}\n\nMore text.')).toEqual([])
    expect(writeOpen(parse('{{Why|The cache key misses the lockfile.}}\n\nMore text.'))).toBe('The cache key misses the lockfile.\n\nMore text.')
    expect(linkable('Intro line.\n## {{Details|the long part goes here}}\nOutro.')).toEqual([])
    expect(linkable('Intro line.\n**{{Root cause|a stale cache key in CI}}**\nOutro.')).toEqual([])
    expect(linkable('{{Next steps|rerun the job after the fix}}')).toEqual([])
  })

  test('a colon or a question alone on its line is a label; inside a sentence a colon stays a link', () => {
    expect(linkable('Intro.\n{{The cause:|the cache key misses the lockfile}}\nOutro.')).toEqual([])
    expect(linkable('**{{Details|the long part goes here}}:**\nMore.')).toEqual([])
    expect(linkable('{{Why does it fail?|the cache key misses the lockfile}}\n\nMore.')).toEqual([])
    expect(linkable('There are {{two options:|retry or rebuild}} the cache.')).toEqual(['two options:'])
  })

  test('a quote mark, a bullet or a list number before a label is still a label', () => {
    for (const lead of ['- ', '+ ', '* ', '> ', '1. ', '2) ', '> - ']) {
      expect(linkable(`Intro.\n${lead}{{Root cause|a stale cache key in CI}}\nOutro.`)).toEqual([])
    }
  })

  test('a short sentence alone on its line is still a label, as before', () => {
    expect(linkable('{{Fixed.|the cache key now hashes the lockfile}}')).toEqual([])
  })

  test('a phrase inside a sentence, or a whole sentence on its own, stays a stretch', () => {
    expect(linkable('The build fails {{on a stale cache|because the key is stale}}.')).toEqual(['on a stale cache'])
    expect(linkable('{{The fix is one line.|Add the lockfile to the key.}}')).toEqual(['The fix is one line.'])
    expect(linkable('{{a|the alpha}} {{b|the beta}}')).toEqual(['a', 'b'])
    expect(linkable('Lead {{a|the alpha {{Why|nested label inside}} more}} end.')).toEqual(['a', 'Why'])
  })

  test('code spans and template braces are untouched', () => {
    expect(writeOpen(parse('`{{Why|no}}`\n\n{{ name }}'))).toBe('`{{Why|no}}`\n\n{{ name }}')
  })

  test('a label draws open in the terminal, with no link, and is not reported', async ($, on) => {
    const text = '{{Why it fails|the cache key misses the lockfile, so CI restores a stale cache}}\n\nThe fix {{is small|adds the lockfile to the key}}.'
    const contexts = conversation(
      on,
      () => [user('q', guide(DEFAULT_SHORT_WORDS)), assistant(text)],
      () => [
        { role: 'user', text: 'q', toolUses: [] },
        { role: 'assistant', text, toolUses: [] },
      ],
    )
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Markdown } = $.ui.resolve(e)
      return <Markdown text={e.props.text} />
    })
    const ui = await mount($, text)
    const markdown = (await ui.findAll({ type: 'Markdown' })).map(m => m.text ?? '').join('\n')
    expect(markdown).toContain('the cache key misses the lockfile, so CI restores a stale cache')
    expect(markdown).not.toContain('{{')
    expect((await rowsOf(ui, 'paragraph-1')).join('\n')).toBe('The fix is small.')
    await submit($)
    expect(contexts[0]).toEqual(['Stretch: in your last reply the reader opened none of "is small". They may have read only the short forms; where clicks cannot land (a terminal not in fullscreen, VS Code, the phone app) every stretch was drawn open.'])
    await ui.unmount()
  })

  test('on desktop a label is plain text, never a link', async $ => {
    const ui = await $.ui.mount({
      plugin: 'stretch',
      surface: 'desktop',
      component: 'AssistantMessage',
      props: { text: '{{Why|the cache key misses the lockfile}}\n\nThe fix {{is small|adds the lockfile}}.', isFirstOfReply: true },
      requestId: 'reply-1',
    })
    const md = (await ui.find({ type: 'Markdown' }))?.text ?? ''
    expect(md).toBe('the cache key misses the lockfile\n\nThe fix [is small](https://stretch.invalid/open/0).')
    await ui.unmount()
  })
})
