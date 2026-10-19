// Stretch replies for Claude Code. Adapted from cc-stretch (https://github.com/pro-vi/cc-stretch),
// MIT License, Copyright (c) 2026 pro-vi; see ../LICENSE-cc-stretch.
//
// There is deliberately no classic.MessageDisplay hook. On 2.1.300 a display filter that hides
// long forms while a reply streams also strips the markup from the text AssistantMessage later
// receives, so no stretch could become clickable (cc-stretch issue #3). While a reply streams, a
// stretch whose closing braces have not arrived shows as literal text until they do: the engine
// draws the streaming text itself, and AssistantMessage first sees a block once it has landed.
//
// The guide rides on the prompt as context rather than in the system prompt: where an organization
// manages Claude Code, prompt.compose passes over the plugins a person installs.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, SessionMessage } from 'claude-code'

import { DEFAULT_SHORT_WORDS, guide, lastSentIn, MAX_SHORT_WORDS, MIN_SHORT_WORDS, OFF_NOTE, settingsOf, wordsOf } from './guide'
import type { Sent, Settings } from './guide'
import { stripMarkers } from './layout'
import type { Link, LinksPost, LinksProps } from './links'
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

// The $.store key holding whether the reader turned stretch off; absent means on.
const ENABLED = 'enabled'
// The $.store key holding the word count /stretch words set; absent means the /config setting or its default.
const SHORT_WORDS = 'shortWords'

export const USAGE =
  'Usage: /stretch on | off | open-all | close-all | words N. on and off decide whether replies use the markup, and last across sessions; ' +
  'open-all and close-all open or close every stretch in the latest reply; words N sets how many words a short reply may take ' +
  `(${MIN_SHORT_WORDS} to ${MAX_SHORT_WORDS}), words alone shows the count, and words default forgets the one set here.`

export const FULLSCREEN_NOTE =
  'stretch: these replies are drawn fully open because clicks need the fullscreen renderer. ' +
  'Run /tui fullscreen, or start Claude Code with CLAUDE_CODE_NO_FLICKER=1 if it already says fullscreen is on.'

// Words a stretch adds take one of four theme colours, mixed toward the text colour; all but the
// newest open stretch fade toward the background.
const BASE = {
  dark: [[255, 193, 7], [175, 135, 255], [72, 150, 140], [215, 119, 87]],
  light: [[150, 108, 30], [135, 0, 255], [0, 102, 102], [215, 119, 87]],
}
const mix = (rgb: number[], toward: number, share: number) => rgb.map(v => Math.round(v + (toward - v) * share))
const hex = (rgb: number[]) => `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`
const paletteOf = (base: number[][], text: number, background: number) =>
  base.map(rgb => mix(rgb, text, 0.45)).map(soft => ({ soft: hex(soft), faded: hex(mix(soft, background, 0.35)) }))
const PALETTES = { dark: paletteOf(BASE.dark, 255, 0), light: paletteOf(BASE.light, 0, 255) }
const HUES = BASE.dark.length

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
      description: 'Turn stretch replies on or off, open or close every stretch in the latest reply, or set the short reply length',
      argumentHint: '[on|off|open-all|close-all|words N]',
    })
    return next(e)
  })

  // A /config value at the default reads as the default.
  const isConfigured = wordsOf(options?.shortWords) !== undefined && settings.shortWords !== DEFAULT_SHORT_WORDS
  on('command.run', { command: 'stretch' }, async ($, e) => ({ text: await runCommand($, e.args.trim().toLowerCase(), settings, isConfigured) }))

  on('prompt.submit', async ($, e, next) => {
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
      const { Box, Client, Markdown, Text } = $.ui.resolve(e)
      const [{ order, count }, newest, bulk] = await Promise.all([
        read($, memberOf(stretchOrder, { requestId: e.requestId })),
        read($, newestReply),
        read($, bulkAction),
      ])
      // An open-all or close-all reaches the Clients of the reply it was aimed at.
      const aimed: Bulk | undefined = bulk.requestIds.includes(e.requestId) ? { id: bulk.id, action: bulk.action } : undefined
      const isLight =
        Object.keys(order).length > 0 &&
        (await $.config.list().catch(() => [])).some(row => row.key === 'theme' && String(row.value).startsWith('light'))
      const palette = isLight ? PALETTES.light : PALETTES.dark
      const counted = await Promise.all(
        paragraphsOf(text).map(async (paragraph, i) => {
          // A paragraph whose only stretches are labels is drawn with them open.
          if (!paragraph.hasStretch) return { node: <Markdown text={paragraph.text.includes('{{') ? writeOpen(parse(paragraph.text)) : paragraph.text} />, opened: 0 }
          const key = `paragraph-${i}`
          const open = await read($, memberOf(openStretches, { requestId: `${e.requestId}#${key}` }))
          const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1, palette)
          const props: ReplyProps = { text: paragraph.text, open, tints, ...(aimed !== undefined && { bulk: aimed }) }
          // The open list holds only keys of linkable stretches, nested ones among them.
          const opened = stretches(parse(paragraph.text)).filter(stretch => isLinkable(stretch) && open.includes(stretch.key)).length
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
      return (
        <Box flexDirection="row">
          <Text>{marker}</Text>
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

  // A paragraph's Client posts its open stretches whenever they change, and the one just opened.
  on('ui.message', async ($, e, next) => {
    if (e.module.endsWith('links.tsx')) {
      const href = linksPostOf(e.data)?.href
      if (href !== undefined) await linkPressed($, href, e)
      return next(e)
    }
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
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
      const n = parent !== undefined && count % HUES === parent % HUES ? count + 1 : count
      return { order: { ...kept, [`${here}${opened.key}`]: n }, count: n + 1 }
    })
    if (opened !== undefined) await update($, newestReply, () => e.requestId)
    return next(e)
  })
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

function tintsOf(order: Record<string, number>, paragraph: string, newest: number, palette: { soft: string; faded: string }[]): Record<string, Tint> {
  const here = `${paragraph}#`
  return Object.fromEntries(
    Object.entries(order)
      .filter(([at]) => at.startsWith(here))
      .flatMap(([at, n]) => {
        const colours = palette[n % palette.length]
        return colours === undefined ? [] : [[at.slice(here.length), { words: n === newest ? colours.soft : colours.faded, closer: colours.soft }]]
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

/** Runs `/stretch <args>` and answers the line it prints. */
async function runCommand($: EngineInterface, args: string, settings: Settings, isConfigured: boolean): Promise<string> {
  const [word = '', ...rest] = args.split(/\s+/)
  if (word === 'words') return runWords($, rest.join(' '), settings, isConfigured)
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
 * the next request is built from holds none (a new session, a /clear, a compaction) or holds the
 * off note or another word count after it; the off note where stretch is off and a guide stands
 * last. Undefined when nothing needs saying, or when the conversation cannot be read.
 */
export async function guideNote($: EngineInterface, isOn: boolean, shortWords: number): Promise<string | undefined> {
  const messages: unknown = await $.session.messages({ as: 'api' }).catch(() => undefined)
  if (!Array.isArray(messages)) return undefined
  let last: Sent | undefined
  for (const message of messages as unknown[]) {
    if (typeof message !== 'object' || message === null || !('role' in message) || !('content' in message)) return undefined
    if (!Array.isArray(message.content)) return undefined
    if (message.role !== 'user') continue
    for (const block of message.content as unknown[]) {
      const text = typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string' ? block.text : ''
      last = lastSentIn(text) ?? last
    }
  }
  if (isOn) return last?.kind === 'guide' && last.words === shortWords ? undefined : guide(shortWords)

  return last?.kind === 'guide' ? OFF_NOTE : undefined
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
