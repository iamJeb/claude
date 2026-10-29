// How closed stretches are marked: the marks and highlight settings, the tinted highlight and the
// text colour chosen to read on a highlight, and the /stretch style toolbar above the prompt.

import type { On, SessionMessage } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { contrastOn } from '../hooks/contrast'
import { settingsOf } from '../hooks/guide'
import { DEFAULT_LOOK, lookOf, marksSetting } from '../hooks/look'

const REPLY = [
  'The build fails {{on a stale cache|because the cache key hashes only `package.json`{{, set in one file|, set in `ci/cache.ts`}}}}.',
  'Braces in code stay: `{{a|b}}`.',
  '',
  '{{The fix is one line.|Add the lockfile to the key.}}',
].join('\n')

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const FIRST = 'paragraph-0'
// The dark theme's colours for a closed stretch's tinted highlight, and for the words it adds once open, by place.
const DEEP = ['#403002', '#2c2240', '#122623', '#361e16'] as const
const SOFT = ['#ffdd77', '#d3bdff', '#9ac5c0', '#e9b4a3'] as const

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
/** Presses `phrase` where the Client drew it, as a mouse does: down, then up. */
const pressOn = async (ui: Mounted, phrase: string, key = FIRST) => {
  const rows = await rowsOf(ui, key)
  const y = rows.findIndex(row => row.includes(phrase))
  if (y === -1) throw new Error(`"${phrase}" is not drawn:\n${rows.join('\n')}`)
  const x = (rows[y] ?? '').indexOf(phrase)
  await ui.pointer({ type: 'down', x, y, button: 'left', in: key })
  await ui.pointer({ type: 'up', x, y, button: 'left', in: key })
}
const phraseProps = async (ui: Mounted, phrase = 'on a stale cache', key = FIRST) => (await ui.findAll({ type: 'Text', in: key })).find(piece => piece.text === phrase)?.props
const toasts = (on: On) => {
  const said: string[] = []
  on('ui.toast', (_, e) => {
    said.push(e.text)
    return { value: undefined }
  })
  return said
}

describe('the marks and highlight settings', () => {
  test('settingsOf reads both into the look, at the default when missing', () => {
    expect(settingsOf(undefined).look).toEqual(DEFAULT_LOOK)
    expect(settingsOf({ marks: 'bold, dim', highlight: '#264F78' }).look).toEqual({ marks: ['bold', 'dim'], highlight: '#264f78' })
    expect(settingsOf({ highlight: 'Tinted' }).look).toEqual({ marks: ['underline'], highlight: 'tinted' })
  })

  test('lookOf reads marks in any case, with commas or spaces, in toolbar order', () => {
    expect(lookOf({ marks: 'Underline , BOLD' }).marks).toEqual(['bold', 'underline'])
    expect(lookOf({ marks: 'italic bold' }).marks).toEqual(['bold', 'italic'])
    expect(lookOf({ marks: ' NONE ', highlight: '#264f78' })).toEqual({ marks: [], highlight: '#264f78' })
    expect(lookOf({ highlight: ' TINTED ' }).highlight).toBe('tinted')
    for (const unknown of ['none', 'tint', '#zzz', '#264f78ff', 'suggestion']) expect(lookOf({ highlight: unknown }).highlight).toBe('')
    for (const typo of ['undrline', 'inverse', 42, ' ']) expect(lookOf({ marks: typo })).toEqual(DEFAULT_LOOK)
  })

  test('a style with no marks is saved as none, which reads back as no marks', () => {
    expect(marksSetting([])).toBe('none')
    expect(lookOf({ marks: marksSetting([]) }).marks).toEqual([])
    expect(lookOf({ marks: marksSetting(['bold', 'underline']) }).marks).toEqual(['bold', 'underline'])
  })

  test('contrastOn picks the stronger of dark and light text, moves it 40 percent toward the highlight under dim, and leaves non-hex colours alone', () => {
    expect(contrastOn('#264f78', true)).toEqual({ color: '#a0b1c1' })
    expect(contrastOn('#ffd75f', true)).toEqual({ color: '#776737' })
    expect(contrastOn('#ffd75f')).toEqual({ color: '#1c1c1c' })
    expect(contrastOn('#264f78')).toEqual({ color: '#f2f2f2' })
    expect(contrastOn('#fff')).toEqual({ color: '#1c1c1c' })
    expect(contrastOn('#808080')).toEqual({ color: '#1c1c1c' })
    for (const colour of ['suggestion', '', '#GGGGGG', 'rgb(0,0,0)']) expect(contrastOn(colour)).toEqual({})
  })
})

describe('a closed stretch drawn under a style', () => {
  test('with no settings, a pressable phrase is underlined and nothing else', async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ underline: true })
    for (const prop of ['bold', 'italic', 'color', 'backgroundColor', 'dimColor', 'inverse', 'strikethrough']) expect(phrase).not.toHaveProperty(prop)
    await ui.unmount()
  })

  test('marks dim draws a pressable phrase dim instead of underlined, and it still opens', { options: { marks: 'dim' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ dimColor: true })
    expect(await phraseProps(ui)).not.toHaveProperty('underline')
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    expect(await textIn(ui)).toContain('because the cache key hashes only package.json')
    await ui.unmount()
  })

  test('a highlight alone keeps the default underline, its text turned light on a deep colour', { options: { highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ underline: true, backgroundColor: '#264f78', color: '#f2f2f2' })
    await ui.unmount()
  })

  test('a light highlight from the settings turns the phrase text dark', { options: { highlight: '#ffd75f' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ backgroundColor: '#ffd75f', color: '#1c1c1c' })
    await ui.unmount()
  })

  test('italic and strikethrough combine with a highlight', { options: { marks: 'italic,strikethrough', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ italic: true, strikethrough: true, backgroundColor: '#264f78' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
  })

  test('marks none leaves a highlighted phrase only its highlight', { options: { marks: 'none', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ backgroundColor: '#264f78', color: '#f2f2f2' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
  })

  test('dim on a highlight moves the text colour chosen to read on it toward the highlight', { options: { marks: 'dim', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ backgroundColor: '#264f78', color: '#a0b1c1' })
    expect(phrase).not.toHaveProperty('dimColor')
    await ui.unmount()
  })

  test('a highlight that is neither hex nor tinted is none, so dim is the theme grey', { options: { marks: 'dim', highlight: 'suggestion' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ dimColor: true })
    expect(phrase).not.toHaveProperty('backgroundColor')
    await ui.unmount()
  })

  test('an opened stretch keeps its tint under a style with dim and a highlight', { options: { marks: 'bold,dim', highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN)
    await pressOn(ui, 'on a stale cache')
    await ui.advance(2000)
    const closer = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === '«')?.props
    expect(closer?.color).toMatch(/^#/)
    expect(closer).not.toHaveProperty('backgroundColor')
    expect(closer).not.toHaveProperty('dimColor')
    expect(closer).toMatchObject({ bold: true })
    await ui.unmount()
  })

  test('the » on a stretch that holds another is dimmed toward the highlight inside the phrase', { options: { highlight: '#264f78' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'See {{the outer one|the outer one, with {{an inner one|an inner one too}}}} now.')
    const mark = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === '»')?.props
    expect(mark).toMatchObject({ backgroundColor: '#264f78', color: '#a0b1c1' })
    expect(mark).not.toHaveProperty('dimColor')
    await ui.unmount()
  })

  for (const highlight of ['#264f78', '']) {
    const name = highlight === '' ? 'stays dim with no highlight' : 'takes the highlight, its text colour moved toward it as dim'
    test(`the target written after a relative link in a short form ${name}`, { options: { highlight } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'Read {{the [guide](docs/guide.md)|the [guide](docs/guide.md) first}} now.')
      const target = (await ui.findAll({ type: 'Text', in: FIRST })).find(piece => piece.text === ' (docs/guide.md)')?.props
      if (highlight === '') {
        expect(target).toMatchObject({ dimColor: true })
      } else {
        expect(target).toMatchObject({ backgroundColor: highlight, color: '#a0b1c1' })
        expect(target).not.toHaveProperty('dimColor')
      }
      await ui.unmount()
    })
  }

  test('under dim, a link inside a short form keeps its colour while the words around it dim', { options: { marks: 'dim' } }, async $ => {
    const ui = await mountReply($, FULLSCREEN, 'See {{the docs at https://x.invalid/d|the docs at https://x.invalid/d, with examples}} now.')
    const pieces = await ui.findAll({ type: 'Text', in: FIRST })
    const url = pieces.find(piece => piece.text === 'https://x.invalid/d')?.props
    expect(url).toMatchObject({ color: 'suggestion', underline: true })
    expect(url).not.toHaveProperty('dimColor')
    expect(pieces.find(piece => piece.text === 'the docs at ')?.props).toMatchObject({ dimColor: true })
    await ui.unmount()
  })

  describe('the tinted highlight', () => {
    const backgroundOf = async (ui: Mounted, phrase: string, key = FIRST) => (await phraseProps(ui, phrase, key))?.backgroundColor

    test('highlights each closed stretch in the colour of its place, counted across the reply', { options: { highlight: ' Tinted ' } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.\n\nThen {{three|three more}}.')
      expect(await backgroundOf(ui, 'one')).toBe(DEEP[0])
      expect(await backgroundOf(ui, 'two')).toBe(DEEP[1])
      expect(await backgroundOf(ui, 'three', 'paragraph-1')).toBe(DEEP[2])
      expect(await phraseProps(ui, 'one')).toMatchObject({ underline: true, color: '#f2f2f2' })
      await ui.unmount()
    })

    test('an opened stretch takes the colour of its place, not of the order it was opened in', { options: { highlight: 'tinted' } }, async $ => {
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      await pressOn(ui, 'two')
      await ui.advance(2000)
      const added = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => piece.text.trim() === 'more')
      expect(added.map(piece => piece.props.color)).toEqual([SOFT[1]])
      expect(await backgroundOf(ui, 'one')).toBe(DEEP[0])
      await ui.unmount()
    })

    test('a nested stretch never takes the colour of the stretch holding it', { options: { highlight: 'tinted' } }, async $ => {
      // Every short form here reads as part of a sentence, so none is drawn open as a label.
      const ui = await mountReply($, FULLSCREEN, 'The {{plan is set|plan is set: {{alpha first|alpha first, then}} {{beta next|beta next, then}} {{gamma after|gamma after, then}} {{delta last|delta last of all}}}} today.')
      await pressOn(ui, 'plan is set')
      await ui.advance(2500)
      expect(await backgroundOf(ui, 'gamma after')).toBe(DEEP[3])
      expect(await backgroundOf(ui, 'delta last')).toBe(DEEP[1])
      await ui.unmount()
    })

    test('on the light theme each closed stretch is highlighted pale, its text dark', { options: { highlight: 'tinted' } }, async ($, on) => {
      const theme = { key: 'theme', label: 'Theme', kind: 'choice', value: 'light', provider: { plugin: 'engine', tier: 'core' }, isLocked: false } as const
      on('config.list', () => ({ value: [theme] }))
      const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
      expect(await phraseProps(ui, 'one')).toMatchObject({ backgroundColor: '#e5dac7', color: '#1c1c1c' })
      expect(await backgroundOf(ui, 'two')).toBe('#e1bfff')
      await ui.unmount()
    })
  })

  describe('under letters', () => {
    // The test engine raises prompt.edit and prompt.change as the prompt box does, but has no editor
    // beneath them, so each test stands one in, with the session's messages.
    const engine = (on: On, replies = [REPLY]) => {
      on('prompt.edit', ($, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
      on('prompt.change', ($, e) => ({ text: e.text }))
      on('session.messages', () => ({ value: replies.map(text => ({ role: 'assistant', text, toolUses: [] }) satisfies SessionMessage) }))
    }
    const letters = async (ui: Mounted, key = FIRST) =>
      (await ui.findAll({ type: 'Text', in: key })).filter(piece => piece.props.backgroundColor === 'error').map(piece => piece.text)

    test('with no style set, a short form under letters stays underlined', async ($, on) => {
      engine(on)
      const ui = await mountReply($, FULLSCREEN)
      await ui.press({ key: 'open-letters' })
      const lettered = (await ui.findAll({ type: 'Text', in: FIRST })).filter(piece => ['error', 'permission'].includes(String(piece.props.backgroundColor)))
      // The short form holds a nested stretch, so its » is under the letter too.
      expect(lettered.map(piece => piece.text)).toEqual(['a', 'n a stale cache', '»'])
      for (const piece of lettered) expect(piece.props).toMatchObject({ underline: true })
      await ui.unmount()
    })

    for (const [highlight, shown] of [['#264f78', '#264f78'], ['tinted', DEEP[0]]] as const) {
      test(`with the highlight ${highlight}, the rest of a short form under its letter keeps that highlight`, { options: { highlight } }, async ($, on) => {
        engine(on)
        const ui = await mountReply($, FULLSCREEN)
        await ui.press({ key: 'open-letters' })
        expect(await letters(ui)).toEqual(['a'])
        expect(await phraseProps(ui, 'n a stale cache')).toMatchObject({ backgroundColor: shown, color: '#f2f2f2' })
        expect((await ui.findAll({ type: 'Text', in: FIRST })).some(piece => piece.props.backgroundColor === 'permission')).toBe(false)
        await ui.unmount()
      })
    }

    test('under a highlight, code in a short form under its letter, which takes no highlight, is drawn on the permission colour', { options: { highlight: '#264f78' } }, async ($, on) => {
      const text = 'See {{the `cfg` file|the `cfg` file, in ci}} now.'
      engine(on, [text])
      const ui = await mountReply($, FULLSCREEN, text)
      await ui.press({ key: 'open-letters' })
      expect(await phraseProps(ui, 'cfg')).toMatchObject({ backgroundColor: 'permission' })
      expect(await phraseProps(ui, ' file')).toMatchObject({ backgroundColor: '#264f78' })
      await ui.unmount()
    })
  })
})

describe('the style toolbar', () => {
  /** A session with the terminal attached, where the toolbar is drawn. */
  const terminal = (on: On) => on('session.surfaces', () => ({ value: ['terminal'] }))
  /** /stretch style typed at the prompt, in fullscreen or on the main screen. */
  const runStyle = ($: Engine, isFullscreen = true) =>
    $.command.run({ command: 'stretch', args: 'style', origin: { kind: 'composer' }, presentation: { isFullscreen, columns: 100 } })
  const mountToolbar = ($: Engine) =>
    $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 30 }, view: {} },
      viewport: FULLSCREEN,
    })
  const showToolbar = async ($: Engine) => ({ answer: await runStyle($), toolbar: await mountToolbar($) })
  const keysOf = async (toolbar: Awaited<ReturnType<typeof mountToolbar>>) => (await toolbar.findAll({ type: 'Button' })).map(button => String(button.key))
  /** What the toolbar writes to the settings, each write answered as made. */
  const recordWrites = (on: On) => {
    const written: [string, unknown][] = []
    on('config.set', (_, e) => {
      written.push([e.key, e.value])
      return { value: e.value }
    })
    return written
  }

  test('/stretch style shows the toolbar, and running it again leaves it shown', async ($, on) => {
    terminal(on)
    const { answer, toolbar } = await showToolbar($)
    expect(answer.text).toContain('shown')
    await runStyle($)
    expect((await keysOf(toolbar)).length).toBeGreaterThan(0)
    await toolbar.unmount()
  })

  test('on the main screen the command says why, and shows no toolbar', async ($, on) => {
    terminal(on)
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const answer = await runStyle($, false)
    expect(answer.text).toContain('/tui fullscreen')
    expect(answer.text).toContain('CLAUDE_CODE_NO_FLICKER=1')
    const toolbar = await mountToolbar($)
    expect(await keysOf(toolbar)).toEqual([])
    await toolbar.unmount()
  })

  test('with no terminal attached the command says the toolbar is drawn there, and shows none', async ($, on) => {
    on('session.surfaces', () => ({ value: ['desktop'] }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const answer = await runStyle($)
    expect(answer.text).toContain('drawn in the terminal')
    const toolbar = await mountToolbar($)
    expect(await keysOf(toolbar)).toEqual([])
    await toolbar.unmount()
  })

  test('the usage line names style, and an unknown word still says so', async ($, on) => {
    terminal(on)
    const answer = await $.command.run({ command: 'stretch', args: 'styl', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    expect(answer.text).toContain('"styl" is not a /stretch option')
    expect(answer.text).toContain('| style.')
  })

  test('a stored try with no highlight is no try, so there is nothing to reset or save', async ($, on) => {
    terminal(on)
    on('state.get', (_, e, next) => (e.plugin === 'stretch' && e.key === 'look' ? { value: { value: { marks: ['bold'] }, version: 0 } } : next(e)))
    const { toolbar } = await showToolbar($)
    const keys = await keysOf(toolbar)
    expect(keys).not.toContain('save')
    expect(keys).not.toContain('reset')
    await toolbar.unmount()
  })

  test('the toolbar offers five marks and three highlight choices, and no text colour', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    const keys = await keysOf(toolbar)
    expect(keys.filter(key => key.startsWith('mark-'))).toEqual(['mark-bold', 'mark-italic', 'mark-underline', 'mark-strikethrough', 'mark-dim'])
    expect(keys.filter(key => key.startsWith('highlight-'))).toEqual(['highlight-none', 'highlight-colour', 'highlight-tinted'])
    expect(keys.some(key => key.startsWith('text-'))).toBe(false)
    await toolbar.unmount()
  })

  test('the deep swatches show only while a colour is chosen, and colour starts at the first', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'highlight-colour' })
    expect((await keysOf(toolbar)).filter(key => key.startsWith('highlight-#'))).toHaveLength(9)
    const chosen = (await toolbar.findAll({ type: 'Text' })).filter(piece => piece.text === '◆◆')
    expect(chosen.map(piece => piece.props.backgroundColor)).toEqual(['#264f78'])
    await toolbar.press({ key: 'highlight-tinted' })
    expect((await keysOf(toolbar)).filter(key => key.startsWith('highlight-#'))).toEqual([])
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['stretch.highlight', 'tinted']])
    await toolbar.unmount()
  })

  test('the toolbar restyles replies live', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-underline' })
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'highlight-#5c4a00' })
    const ui = await mountReply($, FULLSCREEN)
    const phrase = await phraseProps(ui)
    expect(phrase).toMatchObject({ bold: true, backgroundColor: '#5c4a00', color: '#f2f2f2' })
    expect(phrase).not.toHaveProperty('underline')
    await ui.unmount()
    await toolbar.unmount()
  })

  test('a tinted try highlights each closed stretch in the colour of its place', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'highlight-tinted' })
    const ui = await mountReply($, FULLSCREEN, 'A {{one|one more}} and {{two|two more}}.')
    expect(await phraseProps(ui, 'one')).toMatchObject({ backgroundColor: DEEP[0], color: '#f2f2f2' })
    expect(await phraseProps(ui, 'two')).toMatchObject({ backgroundColor: DEEP[1] })
    await ui.unmount()
    await toolbar.unmount()
  })

  test('reset and save show only while a try differs from the saved style', async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.press({ key: 'mark-bold' })
    expect(await keysOf(toolbar)).toEqual(expect.arrayContaining(['reset', 'save']))
    await toolbar.press({ key: 'mark-bold' })
    expect(await keysOf(toolbar)).not.toContain('reset')
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('reset returns to the saved style', { options: { marks: 'dim' } }, async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-italic' })
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).toMatchObject({ italic: true, dimColor: true })
    await toolbar.press({ key: 'reset' })
    const again = await mountReply($, FULLSCREEN, REPLY, 'reply-2')
    const phrase = await phraseProps(again)
    expect(phrase).toMatchObject({ dimColor: true })
    expect(phrase).not.toHaveProperty('italic')
    await again.unmount()
    await ui.unmount()
    await toolbar.unmount()
  })

  test('save writes the marks and the highlight when both changed, none for no marks', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-underline' })
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['stretch.marks', 'none'], ['stretch.highlight', '#264f78']])
    // The try is gone once saved, so nothing is left to save.
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('a refused save keeps the try and says why', async ($, on) => {
    terminal(on)
    on('config.set', () => ({ deny: 'a managed setting owns it' }))
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'save' })
    expect(said).toEqual(['stretch: the style was not saved: a managed setting owns it'])
    expect(await keysOf(toolbar)).toContain('save')
    await toolbar.unmount()
  })

  /** A settings writer that holds each write until `release`, saying when one is held. */
  const heldWrites = (on: On) => {
    const written: [string, unknown][] = []
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => (release = resolve))
    let entered: () => void = () => {}
    const held = new Promise<void>(resolve => (entered = resolve))
    on('config.set', async (_, e) => {
      entered()
      await gate
      written.push([e.key, e.value])
      return { value: e.value }
    })
    return { written, held, release: () => release() }
  }

  test('while a save is under way the toolbar offers nothing to press, close included', async ($, on) => {
    terminal(on)
    const writes = heldWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    const saving = toolbar.press({ key: 'save' })
    await writes.held
    expect(await keysOf(toolbar)).toEqual([])
    writes.release()
    await saving
    expect(await keysOf(toolbar)).toContain('close')
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('a mark pressed together with save is saved or kept as the try, never lost', async ($, on) => {
    terminal(on)
    const written = recordWrites(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await Promise.all([toolbar.press({ key: 'mark-italic' }), toolbar.press({ key: 'save' })])
    const savedItalic = written.some(([key, value]) => key === 'stretch.marks' && String(value).includes('italic'))
    expect(savedItalic || (await keysOf(toolbar)).includes('save')).toBe(true)
    await toolbar.unmount()
  })

  test('save writes only the settings that changed, and a later refusal names what was saved', async ($, on) => {
    terminal(on)
    const written: [string, unknown][] = []
    on('config.set', (_, e) => {
      if (e.key === 'stretch.highlight' && written.length > 0) return { deny: 'a managed setting owns it' }
      written.push([e.key, e.value])
      return { value: e.value }
    })
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['stretch.highlight', '#264f78']])
    await toolbar.press({ key: 'mark-bold' })
    // The test engine does not load the plugin again with the saved settings, so after the save the
    // toolbar shows the style it loaded with, which has no highlight, and colour must be pressed
    // again before a swatch shows.
    await toolbar.press({ key: 'highlight-colour' })
    await toolbar.press({ key: 'highlight-#1f3a5f' })
    await toolbar.press({ key: 'save' })
    expect(written).toEqual([['stretch.highlight', '#264f78'], ['stretch.marks', 'bold,underline']])
    expect(said).toEqual(['stretch: marks saved, highlight not saved: a managed setting owns it'])
    await toolbar.unmount()
  })

  test('close and save pressed together never say a style was dropped that then is saved', async ($, on) => {
    terminal(on)
    // What is drawn above the prompt once the toolbar steps aside.
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const written = recordWrites(on)
    const said = toasts(on)
    for (const order of [['close', 'save'], ['save', 'close']] as const) {
      written.length = 0
      said.length = 0
      await runStyle($)
      const toolbar = await mountToolbar($)
      await toolbar.press({ key: 'mark-bold' })
      await Promise.allSettled(order.map(key => toolbar.press({ key })))
      if (said.includes('stretch: the style you tried was not saved')) expect(written).toEqual([])
      else expect(written).toEqual([['stretch.marks', 'bold,underline']])
      await toolbar.unmount()
    }
  })

  test('a highlight saved in capitals is the chosen swatch, with nothing to reset or save', { options: { highlight: '#264F78' } }, async ($, on) => {
    terminal(on)
    const { toolbar } = await showToolbar($)
    const chosen = (await toolbar.findAll({ type: 'Text' })).filter(piece => piece.text === '◆◆')
    expect(chosen.map(piece => piece.props.backgroundColor)).toEqual(['#264f78'])
    await toolbar.press({ key: 'highlight-#264f78' })
    expect(await keysOf(toolbar)).not.toContain('save')
    await toolbar.unmount()
  })

  test('close puts the toolbar away and drops a try it did not save, saying so', async ($, on) => {
    terminal(on)
    // What is drawn above the prompt once the toolbar steps aside.
    on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'Box', props: {}, children: [] }))
    const said = toasts(on)
    const { toolbar } = await showToolbar($)
    await toolbar.press({ key: 'mark-bold' })
    await toolbar.press({ key: 'close' })
    expect(await keysOf(toolbar)).toEqual([])
    expect(said).toEqual(['stretch: the style you tried was not saved'])
    const ui = await mountReply($, FULLSCREEN)
    expect(await phraseProps(ui)).not.toHaveProperty('bold')
    await ui.unmount()
    await toolbar.unmount()
  })
})
