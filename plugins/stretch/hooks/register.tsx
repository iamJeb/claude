// Stretch replies for Claude Code.
//
// There is deliberately no classic.MessageDisplay hook. On 2.1.300 a display filter that hides
// long forms while a reply streams also strips the markup from the text AssistantMessage later
// receives, so no stretch could become clickable. While a reply streams, a
// stretch whose closing braces have not arrived shows as literal text until they do: the engine
// draws the streaming text itself, and AssistantMessage first sees a block once it has landed.
//
// The guide rides on the prompt as context rather than in the system prompt: where an organization
// manages Claude Code, prompt.compose passes over the plugins a person installs.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, RenderNode, SessionMessage } from 'claude-code'

import { contrastOn, hex, mix } from './contrast'
import type { Hex, Rgb } from './contrast'
import { DEFAULT_SHORT_WORDS, guide, lastSentIn, MAX_SHORT_WORDS, MIN_SHORT_WORDS, OFF_NOTE, settingsOf, wordsOf } from './guide'
import type { Sent, Settings } from './guide'
import { isWebLink, stripMarkers, targetsIn } from './layout'
import type { Action } from './layout'
import type { Link, LinksPost, LinksProps } from './links'
import { isColour, isSameLook, MARK_NAMES, marksSetting, storedLook, TINTED } from './look'
import type { DrawnLook, Highlight, Look, Mark } from './look'
import { closeAfter, codeSpanEnd, hasNested, isLinkable, isOpenable, KEY_SEPARATOR, markupIn, NESTED_MARK, normalize, paragraphsOf, parentOf, parse, stretches, writeOpen } from './parse'
import type { Segment, Stretch } from './parse'
import type { Bulk, ReplyPost, ReplyProps, Tint } from './reply'

const openStretches = atom({ plugin: 'stretch', key: 'open' } as const, [])
const seen = atom({ plugin: 'stretch', key: 'seen' } as const, [])
// A group with no toggle of its own stands at -1, before any groupsAll id, so it follows groupsAll.
const openGroups = atom({ plugin: 'stretch', key: 'groups' } as const, { isOpen: false, at: -1 })
const groupsAll = atom({ plugin: 'stretch', key: 'groupsAll' } as const, { id: 0, isOpen: false })
const stretchOrder = atom({ plugin: 'stretch', key: 'order' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'stretch', key: 'newest' } as const, '')
const drawnReplies = atom({ plugin: 'stretch', key: 'drawn' } as const, [])
const latestReplies = atom({ plugin: 'stretch', key: 'latest' } as const, [])
const bulkAction = atom({ plugin: 'stretch', key: 'bulk' } as const, { id: 0, action: 'open', requestIds: [] })
const askedStretch = atom({ plugin: 'stretch', key: 'ask' } as const, null)
const lettering = atom({ plugin: 'stretch', key: 'lettering' } as const, null)
// The toolbar's state is plugin state, not module state: as of Claude Code 2.1.312 each setting
// written reloads the plugin, and a save outlives the reload.
const pickedLook = atom({ plugin: 'stretch', key: 'look' } as const, null)
const toolbarShown = atom({ plugin: 'stretch', key: 'toolbar' } as const, false)
const toolbarHolder = atom({ plugin: 'stretch', key: 'busy' } as const, null)

// The highlight colours the toolbar offers: deep colours, whose text turns light. A light highlight
// would draw dark text on a light ground, as a selection does. No text colour is offered: links,
// code and the words a click added already speak in colour.
const SWATCHES = ['#264f78', '#1f3a5f', '#3b4261', '#4b3b6b', '#5c2a4a', '#5f2a2a', '#5c4a00', '#1e4d2b', '#1d4b4b'] as const

/** The letters, in row order: home, top, bottom. */
const LETTERS = 'asdfghjklqwertyuiopzxcvbnm'
// As of Claude Code 2.1.301 a plugin has no chord of its own: a Button naming one of the engine's
// keybinding actions is pressed by that action's chords while no engine handler of it is mounted.
// These two actions scroll the diff panel's file list, bound in its Global context to alt+down and
// ctrl+down, and alt+up and ctrl+up. Checked again in 2.1.312, which lists both actions.
const CHORDS: Record<Action, string> = { open: 'app:diffFileListDown', close: 'app:diffFileListUp' }
/** How many of the latest replies on screen holding a stretch take letters. */
const LETTERED_REPLIES = 3
/** How many of the latest replies drawn by Clients are kept, to find the ones that take letters. */
const KEPT_LETTERED_REPLIES = 50

/**
 * A reply drawn by Clients: its text, whether any of its rows are on screen, and its paragraphs that
 * hold a stretch, with each one's state member.
 */
type LetteredReply = { text: string; isOnScreen: boolean; paragraphs: { member: string; text: string }[] }
// Module state, not an atom: as of Claude Code 2.1.301 a render hook cannot write plugin state.
const letteredReplies = new Map<string, LetteredReply>()

/** A reply's text with its whitespace gone, as the site may break and trim its lines. */
const keyOf = (text: string) => text.replace(/\s+/g, '')

/** Sets `key` in `map` as its newest entry, dropping the oldest past `size`. */
function setNewest<V>(map: Map<string, V>, key: string, value: V, size: number): void {
  map.delete(key)
  map.set(key, value)
  for (const old of map.keys()) {
    if (map.size <= size) break
    map.delete(old)
  }
}

/**
 * The command that opens a URL on this machine, the URL its last argument: `open` on macOS; on
 * Windows `rundll32 url.dll,FileProtocolHandler`, which runs no shell, where `cmd /c start` would
 * read an `&` or a `|` in the URL as its own (checked on Windows 11 with Claude Code 2.1.312: it
 * opens the default browser and exits 0); elsewhere `xdg-open`, its output sent to /dev/null, since
 * a browser it starts can keep those pipes, and `$.process.run` waits for them to close.
 *
 * Which machine this is comes from `process.platform` where the runtime exposes one, and otherwise
 * from `uname -s`: Windows where none starts or where it answers `Windows_NT` (busybox) or names
 * Git Bash, MSYS or Cygwin; macOS for `Darwin`; Linux for anything else.
 *
 * As of Claude Code 2.1.306 a ctrl- or alt-click on a hyperlink in a paragraph a Client draws reaches
 * the Client, and as of 2.1.302 a Client has no call that opens a URL. So the hooks module opens it,
 * as Claude Code 2.1.304 opens a link in a paragraph it draws itself.
 */
async function openerOf($: EngineInterface): Promise<readonly string[]> {
  const platform = await platformOf($)
  if (platform === 'darwin') return ['open']
  if (platform === 'win32') return ['rundll32', 'url.dll,FileProtocolHandler']
  return ['sh', '-c', 'xdg-open "$1" </dev/null >/dev/null 2>&1', 'sh']
}

/** The machine this runs on, in Node's own names: `win32`, `darwin` or `linux` for everything else. */
async function platformOf($: EngineInterface): Promise<'win32' | 'darwin' | 'linux'> {
  // The hooks module has no Node of its own, so `process` is read as a global that may be absent.
  const exposed: unknown = Reflect.get(globalThis, 'process')
  const known = typeof exposed === 'object' && exposed !== null ? Reflect.get(exposed, 'platform') : undefined
  if (known === 'win32' || known === 'darwin') return known
  if (typeof known === 'string') return 'linux'
  const system = await $.process.run(['uname', '-s']).then(({ stdout }) => stdout.trim(), () => undefined)
  if (system === 'Darwin') return 'darwin'
  if (system === undefined || /^(Windows_NT|MINGW|MSYS|CYGWIN)/.test(system)) return 'win32'
  return 'linux'
}

/** Opens `href` as the machine opens a URL, and says so in a toast when it could not. */
async function follow($: EngineInterface, href: string): Promise<void> {
  const isOpened = await $.process.run([...(await openerOf($)), href]).then(({ exitCode }) => exitCode === 0, () => false)
  if (!isOpened) $.ui.toast(`stretch: could not open ${href}`)
}

/**
 * Writes the style being tried into the plugin's settings, the ones that differ from `saved`, then
 * drops the try unless a press since made it differ again. A refusal keeps the try and says what was
 * and was not saved. As of Claude Code 2.1.312 the settings land in the person's user settings, keyed
 * `<plugin>.<field>`, and each write reloads the plugin with them.
 */
function saveLook($: EngineInterface, saved: Look): Promise<void> {
  return withClaim($, 'save', async () => {
    // Read when pressed: a mark pressed after the toolbar was last drawn is part of what is saved.
    const tried = storedLook(await read($, pickedLook))
    if (tried === null) return
    const fields: [string, string, string][] = [
      ['marks', marksSetting(tried.marks), marksSetting(saved.marks)],
      ['highlight', tried.highlight, saved.highlight],
    ]
    const written: string[] = []
    for (const [field, value] of fields.filter(([, value, before]) => value !== before)) {
      const result = await $.config.set({ key: `stretch.${field}`, value }).catch((error: unknown) => ({ deny: error instanceof Error ? error.message : String(error) }))
      if (result.deny !== undefined) {
        $.ui.toast(written.length === 0 ? `stretch: the style was not saved: ${result.deny}` : `stretch: ${written.join(' and ')} saved, ${field} not saved: ${result.deny}`)
        return
      }
      written.push(field)
    }
    await update($, pickedLook, stored => (isSameLook(storedLook(stored) ?? saved, tried) ? null : stored))
  })
}

/** Drops the try, unless a save or a close holds the claim: a reset drawn before it began does nothing then. */
async function resetTry($: EngineInterface): Promise<void> {
  if ((await read($, toolbarHolder)) === null) await update($, pickedLook, () => null)
}

/**
 * Puts the toolbar away; a try not saved goes with it, and the reader is told so. It takes the same
 * claim as a save, so a close and a save pressed together never both act on the try.
 */
function closeToolbar($: EngineInterface, saved: Look): Promise<void> {
  return withClaim($, 'close', async () => {
    const [stored] = await Promise.all([read($, pickedLook), update($, toolbarShown, () => false)])
    await update($, pickedLook, () => null)
    const tried = storedLook(stored)
    if (tried !== null && !isSameLook(tried, saved)) $.ui.toast('stretch: the style you tried was not saved')
  })
}

/**
 * Runs a save or a close under the toolbar's one-at-a-time claim, taken before it reads the try and
 * released after, so a second press, or one from a toolbar drawn before the first began, finds the
 * claim held and does nothing.
 */
async function withClaim($: EngineInterface, holder: 'save' | 'close', run: () => Promise<void>): Promise<void> {
  const taken = { isMine: false }
  await update($, toolbarHolder, held => {
    taken.isMine = held === null
    return taken.isMine ? holder : held
  })
  if (!taken.isMine) return
  try {
    await run()
  } finally {
    await update($, toolbarHolder, () => null)
  }
}

// The $.store key holding whether the reader turned stretch off; absent means on.
const ENABLED = 'enabled'
// The $.store key holding the word count /stretch words set; absent means the /config setting or its default.
const SHORT_WORDS = 'shortWords'

export const USAGE =
  'Usage: /stretch on | off | open-all | close-all | words N | style. on and off decide whether replies use the markup, and last across sessions; ' +
  'open-all and close-all open or close every stretch in the latest reply; words N sets how many words a short reply may take ' +
  `(${MIN_SHORT_WORDS} to ${MAX_SHORT_WORDS}), words alone shows the count, and words default forgets the one set here; ` +
  'style shows a toolbar above the prompt that restyles how closed stretches are marked.'

// Claude Code 2.1.312 can start a session on the main screen even with fullscreen set, and the
// variable overrides that.
const FULLSCREEN_HOW = 'Run /tui fullscreen, or start Claude Code with CLAUDE_CODE_NO_FLICKER=1 if it already says fullscreen is on.'

export const FULLSCREEN_NOTE = `stretch: these replies are drawn fully open because clicks need the fullscreen renderer. ${FULLSCREEN_HOW}`

// Words a stretch adds take one of four theme colours, mixed 45 percent toward the text colour so
// they tint rather than shout. Each open stretch keeps its colour; all but the newest take a faded
// form of it, mixed 35 percent toward the background. In the tinted highlight a closed stretch sits
// on the same theme colour mixed 75 percent toward the background, deep on the dark theme and pale
// on the light one; on both, the text contrastOn picks reads at 10:1 or more.
const BASE: Record<'dark' | 'light', readonly [Rgb, Rgb, Rgb, Rgb]> = {
  dark: [[255, 193, 7], [175, 135, 255], [72, 150, 140], [215, 119, 87]],
  light: [[150, 108, 30], [135, 0, 255], [0, 102, 102], [215, 119, 87]],
}
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
const paletteOf = (base: readonly Rgb[], text: Rgb, background: Rgb) =>
  base.map(rgb => {
    const soft = mix(rgb, text, 0.45)
    return { soft: hex(soft), faded: hex(mix(soft, background, 0.35)), highlight: hex(mix(rgb, background, 0.75)) }
  })
const PALETTES = { dark: paletteOf(BASE.dark, WHITE, BLACK), light: paletteOf(BASE.light, BLACK, WHITE) }
/** How many colours stretches take in turn. */
const HUES = BASE.dark.length
/** `count`, or the next count when `count` would give the colour of the stretch holding it, whose count is `parent`. */
const hueAfter = (count: number, parent: number | undefined) => (parent !== undefined && count % HUES === parent % HUES ? count + 1 : count)
/** The colours (a palette entry) a count or a place picks, taken in turn. */
const colourAt = <Entry,>(palette: readonly Entry[], n: number): Entry | undefined => palette[n % HUES]

// Links the plugin draws are answered by the plugin and never followed; a reserved name resolves nowhere.
export const HREF = 'https://stretch.invalid/'
// The links under a reply that holds two or more stretches, and on a folded or unfolded tool group.
const OPEN_ALL = `${HREF}open-all`
const CLOSE_ALL = `${HREF}close-all`
const GROUP = `${HREF}group`
const GROUPS_OPEN = `${HREF}groups-open`
const GROUPS_CLOSE = `${HREF}groups-close`

export const register: Register = (on, options) => {
  const settings: Settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'stretch',
      description: 'Turn stretch replies on or off, open or close every stretch in the latest reply, set the short reply length, or style closed stretches',
      argumentHint: '[on|off|open-all|close-all|words N|style]',
    })
    return next(e)
  })

  // A /config value at the default reads as the default.
  const isConfigured = wordsOf(options?.shortWords) !== undefined && settings.shortWords !== DEFAULT_SHORT_WORDS
  on('command.run', { command: 'stretch' }, async ($, e) => ({ text: await runCommand($, e.args.trim().toLowerCase(), settings, isConfigured, e.presentation) }))

  // The style toolbar, above the prompt while /stretch style has it open. Terminal only: as of
  // Claude Code 2.1.312 the desktop app draws each Button natively, where a highlight swatch has no
  // label. The band above the prompt has its own [-], which collapses it without the plugin
  // knowing, so the command only shows the toolbar and close puts it away.
  const baseLook = settings.look
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.hasSurvey || !(await read($, toolbarShown))) return next(e)
    const [stored, holder] = await Promise.all([read($, pickedLook), read($, toolbarHolder)])
    const tried = storedLook(stored)
    const look = tried ?? baseLook
    // Only a try that differs from the saved style leaves anything to reset or save.
    const isTrying = tried !== null && !isSameLook(tried, baseLook)
    // Each press starts from the look as it is now, not as this draw saw it, so quick presses add up.
    const change = (edit: (now: Look) => Partial<Look>) =>
      update($, pickedLook, stored => {
        const now = storedLook(stored) ?? baseLook
        return { ...now, ...edit(now) }
      })
    const setHighlight = (highlight: Highlight) => () => change(() => ({ highlight }))
    // One colour for every stretch: the one being tried, else the saved one, else the first swatch; the
    // swatches then pick which.
    const startColour = isColour(baseLook.highlight) ? baseLook.highlight : SWATCHES[0]
    const pickColour = () => change(now => ({ highlight: isColour(now.highlight) ? now.highlight : startColour }))
    const toggle = (mark: Mark) => change(now => ({ marks: now.marks.includes(mark) ? now.marks.filter(m => m !== mark) : [...now.marks, mark] }))
    const { Box, Button, Text } = $.ui.resolve(e)
    const chosen = (isOn: boolean, label: string) => (isOn ? <Text bold>[{label}]</Text> : <Text>{label}</Text>)
    // While a save or a close holds the claim nothing is pressable: a press then would race it.
    const pressable = (key: string, onPress: () => unknown, label: RenderNode) =>
      holder !== null ? <Text key={key}>{label}</Text> : <Button plain key={key} onPress={onPress}>{label}</Button>
    const swatch = (c: Hex) =>
      pressable(`highlight-${c}`, setHighlight(c), <Text backgroundColor={c} {...contrastOn(c)}>{look.highlight === c ? '◆◆' : '  '}</Text>)
    const row = (label: string, parts: RenderNode[]) => (
      <Box key={`row-${label}`} flexWrap="wrap" columnGap={1}>
        <Text dimColor>{label.padEnd(9)}</Text>
        {parts}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {row('marks', [
          ...MARK_NAMES.map(mark => pressable(`mark-${mark}`, () => toggle(mark), chosen(look.marks.includes(mark), mark))),
          // A close holds the claim only while the toolbar goes away, so it shows no word.
          ...(holder !== null
            ? holder === 'save' ? [<Text key="saving" dimColor>saving</Text>] : []
            : [
                ...(isTrying
                  ? [
                      <Button plain key="reset" onPress={() => resetTry($)}>reset</Button>,
                      <Button plain key="save" onPress={() => saveLook($, baseLook)}>save</Button>,
                    ]
                  : []),
                <Button plain key="close" onPress={() => closeToolbar($, baseLook)}>close</Button>,
              ]),
        ])}
        {row('highlight', [
          pressable('highlight-none', setHighlight(''), chosen(look.highlight === '', 'no highlight')),
          pressable('highlight-colour', pickColour, chosen(isColour(look.highlight), 'colour')),
          pressable('highlight-tinted', setHighlight(TINTED), chosen(look.highlight === TINTED, 'tinted')),
          ...(isColour(look.highlight) ? SWATCHES.map(swatch) : []),
        ])}
      </Box>
    )
  })

  on('prompt.submit', async ($, e, next) => {
    // Sending a prompt puts the letters away, whatever sent it.
    await update($, lettering, () => null)
    // The /stretch command leaves the latest reply as it was, so open-all and close-all can act on it.
    if (e.command?.name === 'stretch') return next(e)
    // Every other prompt ends the reply the opens belonged to, whatever sent it.
    const [entries, latest] = await Promise.all([read($, seen), read($, latestReplies)])
    await update($, latestReplies, () => [])
    await update($, seen, () => [])
    await update($, newestReply, () => '')

    // Only what a person sends gets the guide: not a headless run, a notification, a peer or a schedule,
    // whose replies are read where no stretch is drawn.
    if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return next(e)

    const isOn = await isEnabled($)
    const note = await guideNote($, isOn, await shortWordsOf($, settings))
    const context = [...(e.context ?? []), ...(note === undefined ? [] : [note])]
    if (e.origin.kind !== 'composer' || !isOn) return note === undefined ? next(e) : next({ ...e, context })

    const written = stretches(parse(stripMarkers(lastReply(await $.session.messages()))))
      .filter(isLinkable)
      .map(stretch => stretch.short.trim())
    // Only opens in the latest reply count, and only for stretches that reply wrote.
    const opened = entries.filter(entry => latest.includes(entry.requestId) && written.includes(entry.short)).map(entry => entry.short)
    const line = contextLine(opened, written)
    if (line === undefined) return note === undefined ? next(e) : next({ ...e, context })

    return next({ ...e, context: [...context, line] })
  }).catch(($, e, next) => next(e))

  // No stretch leaves the chat. A tool call whose input carries the markup is refused with a line
  // the model can act on, since a file, a commit, a message to a person or another agent, or a
  // request to an API would show the raw braces or, copied from the screen, lose the folded text.
  // Turning stretch off lifts the guard, which is how a file that must hold the markup gets written.
  on('tool.call', async ($, e, next) => {
    if (!(await isEnabled($))) return next(e)
    const where = markupIn(e)
    if (where === undefined) return next(e)
    return { deny: `${$.plugin.name}: ${e.tool} input "${where}" carries {{short|long}} markup, which belongs only in chat replies. Send the same call again written plain, with the long forms in place.` }
  }).catch(($, e, next) => next(e))

  // A finished tool group folds to the engine's one-line summary with a link to unfold it, beside
  // one that unfolds or folds every finished group at once. A live group, or one holding an error,
  // is drawn as the engine draws it.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (!settings.foldTools) return next(e)
    const isFinished = !e.props.isActive && e.props.calls.every(call => !call.isRunning && !call.isErrored && !call.isInterrupted)
    if (!canPress(e) || !isFinished) return next(e)

    const own = memberOf(openGroups, e)
    const [mine, all] = await Promise.all([read($, own), read($, groupsAll)])
    const isOpen = groupIsOpen(mine, all)
    const { Box, Client } = $.ui.resolve(e)
    // The row is a Client of the plugin's own, so no address shows; a press posts the address to
    // the ui.message hook below, which finds the group by the same request id this draw has.
    const toggle = <Client key="tools" module="./links.tsx" props={{ links: groupLinks(isOpen) } satisfies LinksProps} />
    const drawn = await next({ ...e, props: { ...e.props, isExpanded: isOpen } })

    return isOpen ? (
      <Box flexDirection="column">
        {drawn}
        <Box paddingLeft={2}>{toggle}</Box>
      </Box>
    ) : (
      <Box flexDirection="row" alignItems="flex-end" gap={1}>
        {drawn}
        {toggle}
      </Box>
    )
  })

  // The first reply drawn open in a terminal that cannot take clicks carries the note on its first
  // block, once per session. A render hook cannot write plugin state, so the request id is kept here.
  let notedRequest: string | undefined
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true) return next(e)
    const text = stripMarkers(normalize(e.props.text))
    const parts = parse(text)
    const all = stretches(parts)
    if (all.length === 0) {
      // Markup that resolved to plain text (an empty short or long form) is drawn resolved.
      const plain = writeOpen(parts)
      return plain === text ? next(e) : next({ ...e, props: { ...e.props, text: plain } })
    }
    // Desktop: one Markdown block whose closed stretches are links that open in place.
    if (e.surface === 'desktop') {
      const { Markdown } = $.ui.resolve(e)
      const open = memberOf(openStretches, { requestId: `${e.requestId}#desktop` })
      const links: string[] = []
      const text = linkedMarkdown(parts, await read($, open), all, links)
      const press = async (href: string) => {
        const [action, index] = href.slice(HREF.length).split('/')
        const stretch = all[Number(index)]
        if (stretch === undefined) return
        const { key } = stretch
        if (action === 'close') {
          await update($, open, list => list.filter(k => k !== key && !k.startsWith(key + KEY_SEPARATOR)))
          return
        }
        if (action !== 'open') return
        await update($, open, list => (list.includes(key) ? list : [...list, key]))
        const short = stretch.short.trim()
        await noteDrawn($, e.requestId)
        await update($, seen, list => record(list, e.requestId, short))
      }
      return <Markdown key="stretch" text={text} pressableLinks={links} onLinkPress={link => void press(link.href)} />
    }

    const marker = e.props.isFirstOfReply ? '⏺ ' : '  '
    if (canPress(e)) {
      // Fullscreen terminal: a paragraph holding a stretch is drawn by a Client that takes the
      // clicks; the rest is the engine's own markdown.
      const { Box, Button, Client, Markdown, Text } = $.ui.resolve(e)
      const [{ order, count }, newest, bulk, shown, picked] = await Promise.all([
        read($, memberOf(stretchOrder, { requestId: e.requestId })),
        read($, newestReply),
        read($, bulkAction),
        read($, lettering),
        read($, pickedLook),
      ])
      // An open-all or close-all reaches the Clients of the reply it was aimed at.
      const aimed: Bulk | undefined = bulk.requestIds.includes(e.requestId) ? { id: bulk.id, action: bulk.action } : undefined
      const look = storedLook(picked) ?? baseLook
      const isTinted = look.highlight === TINTED
      // The theme matters only once a stretch in this reply is drawn in its colour: open, or with the tinted highlight.
      const isLight =
        (isTinted || Object.keys(order).length > 0) &&
        (await $.config.list().catch(() => [])).some(row => row.key === 'theme' && String(row.value).startsWith('light'))
      const palette = isLight ? PALETTES.light : PALETTES.dark
      const paragraphs = paragraphsOf(text).map((paragraph, i) => ({ ...paragraph, key: `paragraph-${i}`, member: `${e.requestId}#paragraph-${i}` }))
      const holding = paragraphs.filter(p => p.hasStretch)
      const places = isTinted ? placesOf(holding) : undefined
      // The tinted highlight is each stretch's own, handed to the reply by key in place of the look's.
      const drawnLook: DrawnLook = { ...look, highlight: isColour(look.highlight) ? look.highlight : '' }
      // The terminal says again whether a reply is on screen whenever a scroll changes it; null is off it.
      setNewest(letteredReplies, e.requestId, { text, isOnScreen: e.props.onScreen !== null, paragraphs: holding }, KEPT_LETTERED_REPLIES)
      const counted = await Promise.all(
        paragraphs.map(async ({ hasStretch, text, key, member }) => {
          // A paragraph whose only stretches are labels is drawn with them open.
          if (!hasStretch) return { node: <Markdown text={text.includes('{{') ? writeOpen(parse(text)) : text} />, opened: 0 }
          const [open, ask] = await Promise.all([read($, memberOf(openStretches, { requestId: member })), read($, memberOf(askedStretch, { requestId: member }))])
          const placed = places?.get(key)
          const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1, palette, placed)
          const keys = Object.fromEntries((shown?.targets ?? []).filter(one => one.member === member).map(one => [one.key, one.letter]))
          const props: ReplyProps = {
            text,
            open,
            tints,
            ...(aimed !== undefined && { bulk: aimed }),
            ask,
            letters: shown === null ? null : { action: shown.action, keys },
            look: drawnLook,
            highlights: placed === undefined ? {} : highlightsOf(placed, palette),
          }
          // The open list holds only keys of linkable stretches, nested ones among them.
          const opened = stretches(parse(text)).filter(stretch => isLinkable(stretch) && open.includes(stretch.key)).length
          return { node: <Client key={key} module="./reply.tsx" props={props} width="100%" />, opened }
        }),
      )
      const drawn = counted.map(({ node }) => node)
      // A block holding two or more stretches ends in a line that opens or closes them all and counts the open ones.
      const total = all.filter(isLinkable).length
      const opened = counted.reduce((sum, { opened }) => sum + opened, 0)
      // A press on it posts the address to the ui.message hook below, which aims the bulk at this reply.
      const footer = total >= 2 && (
        <Client key="all" module="./links.tsx" props={{ links: footerLinks(opened, total), note: `${opened === 0 ? 'none' : opened} of ${total} open` } satisfies LinksProps} />
      )
      // On a reply's first row the bullet and the space after it are Buttons: the first puts up the
      // letters that open, or puts them away when they show; the second does the same for those that
      // close. A chord presses them, and so does a click.
      return (
        <Box flexDirection="row">
          {e.props.isFirstOfReply
            ? [
                <Button key="open-letters" plain label="⏺" action={CHORDS.open} onPress={() => void showLetters($, 'open')} />,
                <Button key="close-letters" plain label=" " action={CHORDS.close} onPress={() => void showLetters($, 'close')} />,
              ]
            : <Text>{marker}</Text>}
          <Box flexDirection="column" flexShrink={1} gap={1}>
            {drawn}
            {footer}
          </Box>
        </Box>
      )
    }

    // Anywhere a click is not known to land, every stretch is drawn open. In a terminal that is not
    // fullscreen (or does not say), the first such reply says why.
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const needsNote = needsFullscreen(e) && e.props.isFirstOfReply
    if (needsNote) notedRequest ??= e.requestId
    return (
      <Box flexDirection="row">
        <Text>{marker}</Text>
        <Box flexDirection="column" flexShrink={1}>
          <Markdown text={writeOpen(parts)} />
          {needsNote && notedRequest === e.requestId && <Text dimColor>{FULLSCREEN_NOTE}</Text>}
        </Box>
      </Box>
    )
  })

  // A paragraph's Client posts text the reader selected, a hyperlink the reader ctrl- or alt-clicked,
  // and its open stretches whenever they change, with the one just opened.
  on('ui.message', async ($, e, next) => {
    if (e.module.endsWith('links.tsx')) {
      const href = linksPostOf(e.data)?.href
      if (href !== undefined) await linkPressed($, href, e)
      return next(e)
    }
    if (!e.module.endsWith('reply.tsx')) return next(e)
    // Text the reader dragged across in a paragraph, where as of Claude Code 2.1.302 the transcript
    // selects nothing itself.
    const copy = copyOf(e.data)
    if (copy !== undefined) {
      const copied = await $.ui.copy({ text: copy, surface: e.surface })
      if (!copied.isCopied) $.ui.toast(`stretch: the selection was not copied: ${copied.reason}`)
      return next(e)
    }
    // A hyperlink the reader ctrl- or alt-clicked, opened without holding the post's chain on another program.
    const followed = followOf(e.data)
    if (followed !== undefined) {
      void follow($, followed)
      return next(e)
    }
    const post = replyPostOf(e.data)
    if (post === undefined) return next(e)
    if (post.mounted === true) await noteDrawn($, e.requestId)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened, openedAll } = post
    if (opened !== undefined) await update($, seen, list => record(list, e.requestId, opened.short))
    if (openedAll !== undefined) await update($, seen, list => openedAll.reduce((kept, short) => record(kept, e.requestId, short), list))

    const here = `${e.element}#`
    await update($, memberOf(stretchOrder, { requestId: e.requestId }), ({ order, count }) => {
      const kept = Object.fromEntries(Object.entries(order).filter(([at]) => !at.startsWith(here) || post.open.includes(at.slice(here.length))))
      if (opened === undefined) return { order: kept, count }
      const parent = kept[`${here}${parentOf(opened.key)}`]
      const n = hueAfter(count, parent)
      return { order: { ...kept, [`${here}${opened.key}`]: n }, count: n + 1 }
    })
    if (opened !== undefined) await update($, newestReply, () => e.requestId)
    return next(e)
  })

  // While the letters show, the next edit at the prompt puts them away. A key that is one of the
  // letters asks its stretch's paragraph to open or close it, in place as a click does, and is not
  // typed; any other key, including a capital and a letter no stretch has, is typed as usual.
  on('prompt.edit', async ($, e, next) => {
    const shown = await read($, lettering)
    if (shown === null) return next(e)
    await update($, lettering, () => null)
    const typed = e.key?.ctrl === undefined && e.key?.meta === undefined ? e.key?.key : undefined
    const target = shown.targets.find(one => one.letter === typed)
    if (target === undefined) return next(e)
    await update($, memberOf(askedStretch, { requestId: target.member }), last => ({ key: target.key, action: shown.action, n: (last?.n ?? 0) + 1 }))

    return { text: e.text, cursor: e.cursor }
  })

  // A change to the prompt box that is not an edit, such as a recalled history entry or a clear,
  // puts the letters away too. Claude Code 2.1.312 raises prompt.change for those.
  on('prompt.change', async ($, e, next) => {
    if ((await read($, lettering)) !== null) await update($, lettering, () => null)
    return next(e)
  })
}

/**
 * Puts up the letters for `action`, or puts them away when they already show for it or no stretch
 * in the latest replies on screen takes one.
 */
async function showLetters($: EngineInterface, action: Action): Promise<void> {
  const shown = await read($, lettering)
  const targets = shown?.action === action ? [] : await lettersFor($, action)
  await update($, lettering, () => (targets.length === 0 ? null : { action, targets }))
}

/**
 * A letter for each of the first 26 stretches `action` can act on in the latest three replies on
 * screen holding a stretch, newest first, in reading order within each. The order is read from the
 * session's messages because Claude Code 2.1.301 draws a reply for the first time when it scrolls
 * into view.
 */
async function lettersFor($: EngineInterface, action: Action): Promise<{ letter: string; member: string; key: string }[]> {
  // With their whitespace gone, no reply is found across two messages joined by a line break.
  const written = (await $.session.messages().catch(() => []))
    .filter(message => message.role === 'assistant' && message.text.includes('{{'))
    .map(message => keyOf(stripMarkers(normalize(message.text))))
    .join('\n')
  const replies = [...letteredReplies.values()]
    .filter(reply => reply.isOnScreen)
    .map(reply => ({ reply, at: written.lastIndexOf(keyOf(reply.text)) }))
    .filter(({ at }) => at !== -1)
    .sort((a, b) => b.at - a.at)
    .slice(0, LETTERED_REPLIES)
  const paragraphs = replies.flatMap(({ reply }) => reply.paragraphs)
  const targets = await Promise.all(
    paragraphs.map(async ({ member, text }) => {
      const open = await read($, memberOf(openStretches, { requestId: member }))
      return targetsIn(parse(text), open, action).map(stretch => ({ member, key: stretch.key }))
    }),
  )

  return targets.flat().slice(0, LETTERS.length).map((target, i) => ({ ...target, letter: LETTERS.charAt(i) }))
}

/** A Client's post of a web link to open, if it is one. */
function followOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('follow' in data)) return undefined
  return typeof data.follow === 'string' && isWebLink(data.follow) ? data.follow : undefined
}

/** A Client's post of text to copy, if it is one. */
function copyOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null || !('copy' in data)) return undefined
  return typeof data.copy === 'string' && data.copy !== '' ? data.copy : undefined
}

/**
 * The line added to the next prompt: which stretches of the last reply the reader opened and which
 * they did not. Undefined when the last reply had none and nothing was opened.
 */
export function contextLine(openedList: readonly string[], writtenList: readonly string[]): string | undefined {
  const opened = [...new Set(openedList)]
  const unopened = [...new Set(writtenList)].filter(short => !opened.includes(short))
  if (opened.length === 0 && unopened.length === 0) return undefined
  const quote = (list: readonly string[]) => list.map(s => `"${s}"`).join(', ')
  if (opened.length > 0) {
    return `Stretch: in your last reply the reader opened ${quote(opened)}.${unopened.length > 0 ? ` They did not open ${quote(unopened)}.` : ''}`
  }

  return `Stretch: in your last reply the reader opened none of ${quote(unopened)}. They may have read only the short forms; where clicks cannot land (a terminal not in fullscreen, VS Code, the phone app) every stretch was drawn open.`
}

/** Whether a tool group is unfolded: its own toggle while that was pressed under the current bulk, else the bulk. */
function groupIsOpen(own: { isOpen: boolean; at: number } | boolean, all: { id: number; isOpen: boolean }): boolean {
  // State written by 0.2.2 holds a plain boolean, kept as the reader's own choice.
  if (typeof own === 'boolean') return own
  return own.at >= all.id ? own.isOpen : all.isOpen
}

/**
 * Answers the address a links row posted. The row under a reply aims an open-all or close-all at
 * that reply; the row beside a tool group flips the group's own toggle, the member keyed by the
 * request id the ToolGroup draw had, or bumps the toggle over every group.
 */
async function linkPressed($: EngineInterface, href: string, e: Pick<RenderInput, 'requestId' | 'component'>): Promise<void> {
  // Each row answers only the addresses it draws, so a post from one cannot move the other.
  if (e.component === 'AssistantMessage' && (href === OPEN_ALL || href === CLOSE_ALL)) {
    const action: Bulk['action'] = href === OPEN_ALL ? 'open' : 'close'
    await update($, bulkAction, was => ({ id: was.id + 1, action, requestIds: [e.requestId] }))
  } else if (e.component !== 'ToolGroup') {
    return
  } else if (href === GROUP) {
    // The group's own toggle flips what the reader sees now, and outlasts the bulk it was pressed under.
    const own = memberOf(openGroups, e)
    const [was, now] = await Promise.all([read($, own), read($, groupsAll)])
    await update($, own, () => ({ isOpen: !groupIsOpen(was, now), at: now.id }))
  } else if (href === GROUPS_OPEN || href === GROUPS_CLOSE) {
    await update($, groupsAll, was => ({ id: was.id + 1, isOpen: href === GROUPS_OPEN }))
  }
}

/**
 * The links under a block of a reply: open all while a stretch is closed, close all while one is
 * open, both when the block is mixed.
 */
export function footerLinks(opened: number, total: number): Link[] {
  return [
    ...(opened < total ? [{ href: OPEN_ALL, label: '▸ open all' }] : []),
    ...(opened > 0 ? [{ href: CLOSE_ALL, label: '« close all' }] : []),
  ]
}

/** The links beside a tool group: show and show all while it is folded, fold and fold all while it is open. */
export function groupLinks(isOpen: boolean): Link[] {
  return isOpen
    ? [
        { href: GROUP, label: '▾ fold' },
        { href: GROUPS_CLOSE, label: '▾ fold all' },
      ]
    : [
        { href: GROUP, label: '▸ show' },
        { href: GROUPS_OPEN, label: '▸ show all' },
      ]
}

function linksPostOf(data: unknown): LinksPost | undefined {
  if (typeof data !== 'object' || data === null || !('href' in data) || typeof data.href !== 'string') return undefined

  return { href: data.href }
}

/**
 * The tint of each open stretch in one paragraph: its colour by the count it was opened at, or under
 * the tinted highlight by its place, faded unless it was opened at `newest`.
 */
function tintsOf(
  order: Record<string, number>,
  paragraph: string,
  newest: number,
  palette: { soft: string; faded: string }[],
  places?: ReadonlyMap<string, number>,
): Record<string, Tint> {
  const here = `${paragraph}#`
  return Object.fromEntries(
    Object.entries(order)
      .filter(([at]) => at.startsWith(here))
      .flatMap(([at, n]) => {
        const key = at.slice(here.length)
        // Under the tinted highlight a stretch with no place has no colour to keep, so none is made up.
        const place = places === undefined ? n : places.get(key)
        const colours = place === undefined ? undefined : colourAt(palette, place)
        return colours === undefined ? [] : [[key, { words: n === newest ? colours.soft : colours.faded, closer: colours.soft }]]
      }),
  )
}

/**
 * Each pressable stretch's place in a reply, by paragraph then key, which picks its colour under the
 * tinted highlight: counted in reading order across the reply's paragraphs, a nested stretch after the
 * one holding it and never in that one's colour, so a stretch has its colour before it is opened.
 */
function placesOf(paragraphs: { text: string; key: string }[]): Map<string, Map<string, number>> {
  let next = 0
  return new Map(
    paragraphs.map(({ text, key }) => {
      const places = new Map<string, number>()
      // The holding stretch is passed down the parse, not read back from a key, which a short form can spell like a nested one.
      const walk = (segments: Segment[], holder: number | undefined) => {
        for (const segment of segments) {
          if (typeof segment === 'string') continue
          let inside = holder
          if (isLinkable(segment)) {
            inside = hueAfter(next, holder)
            places.set(segment.key, inside)
            next = inside + 1
          }
          walk(segment.long ?? [], inside)
        }
      }
      walk(parse(text), undefined)
      return [key, places]
    }),
  )
}

/** Under the tinted highlight, each stretch's highlight in one paragraph, by key: its colour's deep form. */
function highlightsOf(places: ReadonlyMap<string, number>, palette: readonly { highlight: Hex }[]): Record<string, Hex> {
  return Object.fromEntries(
    [...places].flatMap(([key, place]) => {
      const colours = colourAt(palette, place)
      return colours === undefined ? [] : [[key, colours.highlight]]
    }),
  )
}

/**
 * A reply as desktop markdown: each closed stretch a link, ending in a » when it holds another, each
 * open one its long form then a «.
 */
function linkedMarkdown(parts: Segment[], open: readonly string[], all: Stretch[], links: string[]): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      if (!isOpenable(part) || part.long === undefined) return part.short
      if (!isLinkable(part)) return part.long.length === 0 ? part.short : linkedMarkdown(part.long, open, all, links)
      const index = all.indexOf(part)
      if (open.includes(part.key)) {
        const close = `${HREF}close/${index}`
        links.push(close)
        return closeAfter(linkedMarkdown(part.long, open, all, links), `[«](${close})`, '\n\n')
      }
      const href = `${HREF}open/${index}`
      links.push(href)
      return `[${labelOf(part.short)}${hasNested(part) ? NESTED_MARK : ''}](${href})`
    })
    .join('')
}

/** A short form as link text: links inside it flattened, brackets and backslashes escaped outside code spans. */
function labelOf(short: string): string {
  const plain = (text: string) => text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1 ($2)').replace(/([[\]\\])/g, '\\$1')
  let label = ''
  let from = 0
  for (let at = short.indexOf('`'); at !== -1; at = short.indexOf('`', from)) {
    const stop = codeSpanEnd(short, at)
    label += plain(short.slice(from, at)) + short.slice(at, stop)
    from = stop
  }

  return label + plain(short.slice(from))
}

/** `list` with the open of `short` in reply `requestId` added, once. */
function record(list: readonly { requestId: string; short: string }[], requestId: string, short: string) {
  return list.some(entry => entry.requestId === requestId && entry.short === short) ? [...list] : [...list, { requestId, short }]
}

/**
 * Records that reply `requestId` was drawn. The first time, it joins the latest reply's ids, which
 * the next prompt reads and clears. Kept in plugin state, so a reload of the plugin keeps it.
 */
async function noteDrawn($: EngineInterface, requestId: string): Promise<void> {
  if ((await read($, drawnReplies)).includes(requestId)) return
  await update($, drawnReplies, list => [...list, requestId].slice(-1000))
  await update($, latestReplies, list => (list.includes(requestId) ? list : [...list, requestId]))
}

function replyPostOf(data: unknown): ReplyPost | undefined {
  if (typeof data !== 'object' || data === null || !('open' in data) || !Array.isArray(data.open)) return undefined
  const open = data.open.filter((key): key is string => typeof key === 'string')
  const all = 'openedAll' in data && Array.isArray(data.openedAll) ? data.openedAll.filter((short): short is string => typeof short === 'string') : undefined
  const extra = { ...('mounted' in data && data.mounted === true && { mounted: true as const }), ...(all !== undefined && { openedAll: all }) }
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('short' in opened) || !('key' in opened)) return { open, ...extra }
  const { short, key } = opened

  return typeof short === 'string' && typeof key === 'string' ? { open, opened: { short, key }, ...extra } : { open, ...extra }
}

/** Whether the reader has stretch on: anything but a stored false. */
async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED).catch(() => undefined)) !== false
}

/** The word count /stretch words set, when one is stored and within bounds. */
async function storedWords($: EngineInterface): Promise<number | undefined> {
  return wordsOf(await $.store.get(SHORT_WORDS).catch(() => undefined))
}

/** The word count in force: the one /stretch words set, else the /config setting or its default. */
async function shortWordsOf($: EngineInterface, settings: Settings): Promise<number> {
  return (await storedWords($)) ?? settings.shortWords
}

/** Runs `/stretch words <rest>` and answers the line it prints. `isConfigured`: whether /config holds a valid count. */
async function runWords($: EngineInterface, rest: string, settings: Settings, isConfigured: boolean): Promise<string> {
  const configured = isConfigured ? 'the shortWords setting in /config' : 'the default'
  if (rest === '') {
    const stored = await storedWords($)
    return `stretch: a short reply is ${stored ?? settings.shortWords} words at most, from ${stored === undefined ? configured : '/stretch words'}.`
  }
  if (rest === 'default') {
    await $.store.delete(SHORT_WORDS)
    return `stretch: the count set by /stretch words is forgotten. A short reply is ${settings.shortWords} words at most, from ${configured}.`
  }
  const words = wordsOf(rest)
  if (words === undefined) return `stretch: the word count must be a whole number from ${MIN_SHORT_WORDS} to ${MAX_SHORT_WORDS}. Nothing changed.`
  await $.store.set(SHORT_WORDS, words)

  return `stretch: a short reply is now ${words} words at most. Your next message brings Claude the guide with the new count.`
}

/**
 * Runs `/stretch style`: shows the toolbar above the prompt, in the fullscreen terminal, where a
 * closed stretch is drawn by the plugin. Running it again leaves the toolbar shown.
 */
async function runStyle($: EngineInterface, presentation: { isFullscreen: boolean }): Promise<string> {
  if (!(await $.session.surfaces()).includes('terminal')) return 'stretch: the style toolbar is drawn in the terminal, above the prompt; with no terminal attached there is none.'
  if (!presentation.isFullscreen) return `stretch: the style toolbar is drawn in fullscreen; on the main screen every stretch is drawn open. To use it, ${FULLSCREEN_HOW}`
  await update($, toolbarShown, () => true)
  return 'stretch: style toolbar shown above the prompt; close puts it away.'
}

/** Runs `/stretch <args>` and answers the line it prints. */
async function runCommand($: EngineInterface, args: string, settings: Settings, isConfigured: boolean, presentation: { isFullscreen: boolean }): Promise<string> {
  const [word = '', ...rest] = args.split(/\s+/)
  if (word === 'words') return runWords($, rest.join(' '), settings, isConfigured)
  if (word === 'style') return runStyle($, presentation)
  if (word === 'on' || word === 'off') {
    await $.store.set(ENABLED, word === 'on')
    return word === 'on'
      ? 'stretch is on. Your next message brings Claude the guide again, and replies use the markup from then on.'
      : 'stretch is off. Your next message tells Claude to stop using the markup; stretches already drawn still open.'
  }
  if (word === 'open-all' || word === 'close-all') {
    const latest = await read($, latestReplies)
    if (latest.length === 0) return 'stretch: no reply with clickable stretches has been drawn since your last message.'
    const action: Bulk['action'] = word === 'open-all' ? 'open' : 'close'
    await update($, bulkAction, was => ({ id: was.id + 1, action, requestIds: [...latest] }))
    return word === 'open-all' ? 'Opened every stretch in the latest reply.' : 'Closed every stretch in the latest reply.'
  }
  const state = (await isEnabled($)) ? 'on' : 'off'
  const unknown = word === '' ? '' : `"${word}" is not a /stretch option. `

  return `${unknown}stretch is ${state}, and a short reply is ${await shortWordsOf($, settings)} words at most. ${USAGE}`
}

/**
 * What the next prompt carries for the model about the markup: the guide where the conversation
 * the next request is built from holds none of the current version (a new session, a /clear, a
 * compaction, an older guide) or holds the off note or another word count after it; the off note
 * where stretch is off and a guide of any version stands last, since an older guide still has the
 * model writing the markup. Undefined when nothing needs saying, or when the conversation cannot
 * be read.
 */
export async function guideNote($: EngineInterface, isOn: boolean, shortWords: number): Promise<string | undefined> {
  const messages: unknown = await $.session.messages({ as: 'api' }).catch(() => undefined)
  if (!Array.isArray(messages)) return undefined
  let last: Sent | undefined
  let lastOfAnyVersion: Sent | undefined
  for (const message of messages as unknown[]) {
    if (typeof message !== 'object' || message === null || !('role' in message) || !('content' in message)) return undefined
    if (!Array.isArray(message.content)) return undefined
    if (message.role !== 'user') continue
    for (const block of message.content as unknown[]) {
      const text = typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string' ? block.text : ''
      last = lastSentIn(text) ?? last
      lastOfAnyVersion = lastSentIn(text, true) ?? lastOfAnyVersion
    }
  }
  if (isOn) return last?.kind === 'guide' && last.words === shortWords ? undefined : guide(shortWords)

  return lastOfAnyVersion?.kind === 'guide' ? OFF_NOTE : undefined
}

/** The text of the model's last reply: its rows after the person's last prompt. */
function lastReply(messages: SessionMessage[]): string {
  const texts: string[] = []
  for (const message of [...messages].reverse()) {
    if (message.role === 'user' && (message.toolResults?.length ?? 0) === 0 && message.text !== '') break
    if (message.role === 'assistant') texts.unshift(message.text)
  }

  return texts.join('\n')
}

// A click on a Client, or on the fold link, is known to land only in the fullscreen terminal.
function canPress<E extends Pick<RenderInput, 'surface' | 'viewport'>>(e: E): e is E & { surface: 'terminal' } {
  return e.surface === 'terminal' && e.viewport?.isFullscreen === true
}

// A terminal on its main screen, or one whose viewport is unknown, draws stretches open and says so.
function needsFullscreen(e: Pick<RenderInput, 'surface' | 'viewport'>): boolean {
  return e.surface === 'terminal' && e.viewport?.isFullscreen !== true
}
