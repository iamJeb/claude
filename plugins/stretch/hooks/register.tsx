// Stretch replies for Claude Code. Adapted from cc-stretch (https://github.com/pro-vi/cc-stretch),
// MIT License, Copyright (c) 2026 pro-vi; see ../LICENSE-cc-stretch.
//
// There is deliberately no classic.MessageDisplay hook. On 2.1.300 a display filter that hides
// long forms while a reply streams also strips the markup from the text AssistantMessage later
// receives, so no stretch could become clickable (cc-stretch issue #3). While a reply streams, a
// stretch whose closing braces have not arrived shows as literal text until they do.

import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput, SessionMessage } from 'claude-code'

import { GUIDE } from './guide'
import { stripMarkers } from './layout'
import { closeAfter, codeSpanEnd, isLinkable, isOpenable, KEY_SEPARATOR, normalize, paragraphsOf, parentOf, parse, stretches, writeOpen } from './parse'
import type { Segment, Stretch } from './parse'
import type { ReplyPost, ReplyProps, Tint } from './reply'

const openStretches = atom({ plugin: 'stretch', key: 'open' } as const, [])
const seen = atom({ plugin: 'stretch', key: 'seen' } as const, [])
const openGroups = atom({ plugin: 'stretch', key: 'groups' } as const, false)
const stretchOrder = atom({ plugin: 'stretch', key: 'order' } as const, { order: {}, count: 0 })
const newestReply = atom({ plugin: 'stretch', key: 'newest' } as const, '')
const drawnReplies = atom({ plugin: 'stretch', key: 'drawn' } as const, [])
const latestReplies = atom({ plugin: 'stretch', key: 'latest' } as const, [])

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

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    // Only the main conversation's prompt: not a teammate's render, and not /context's measurement.
    if (e.surfaces.length === 0 || e.traits.includes('teammate') || e.traits.includes('analysis')) return composed

    return { sections: [...composed.sections, { id: 'stretch:guide', text: GUIDE, scope: 'session' }] }
  })

  on('prompt.submit', async ($, e, next) => {
    // Every prompt ends the reply the opens belonged to, whatever sent it.
    const [entries, latest] = await Promise.all([read($, seen), read($, latestReplies)])
    await update($, latestReplies, () => [])
    await update($, seen, () => [])
    await update($, newestReply, () => '')
    if (e.origin.kind !== 'composer') return next(e)

    const written = stretches(parse(stripMarkers(lastReply(await $.session.messages()))))
      .filter(isLinkable)
      .map(stretch => stretch.short.trim())
    // Only opens in the latest reply count, and only for stretches that reply wrote.
    const opened = entries.filter(entry => latest.includes(entry.requestId) && written.includes(entry.short)).map(entry => entry.short)
    const line = contextLine(opened, written)
    if (line === undefined) return next(e)

    return next({ ...e, context: [...(e.context ?? []), line] })
  }).catch(($, e, next) => next(e))

  // A finished tool group folds to the engine's one-line summary with a link to unfold it. A live
  // group, or one holding an error, is drawn as the engine draws it.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    const isFinished = !e.props.isActive && e.props.calls.every(call => !call.isRunning && !call.isErrored && !call.isInterrupted)
    if (!canPress(e) || !isFinished) return next(e)

    const open = memberOf(openGroups, e)
    const isOpen = await read($, open)
    const { Box, Markdown } = $.ui.resolve(e)
    const toggle = (
      <Markdown
        key="tools"
        text={`[${isOpen ? '▾ fold' : '▸ show'}](${HREF})`}
        pressableLinks={[HREF]}
        onLinkPress={() => update($, open, was => !was)}
      />
    )
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
      const [{ order, count }, newest] = await Promise.all([read($, memberOf(stretchOrder, { requestId: e.requestId })), read($, newestReply)])
      const isLight =
        Object.keys(order).length > 0 &&
        (await $.config.list().catch(() => [])).some(row => row.key === 'theme' && String(row.value).startsWith('light'))
      const palette = isLight ? PALETTES.light : PALETTES.dark
      const drawn = await Promise.all(
        paragraphsOf(text).map(async (paragraph, i) => {
          if (!paragraph.hasStretch) return <Markdown text={paragraph.text} />
          const key = `paragraph-${i}`
          const open = await read($, memberOf(openStretches, { requestId: `${e.requestId}#${key}` }))
          const tints = tintsOf(order, key, newest === e.requestId ? count - 1 : -1, palette)
          return <Client key={key} module="./reply.tsx" props={{ text: paragraph.text, open, tints } satisfies ReplyProps} width="100%" />
        }),
      )
      return (
        <Box flexDirection="row">
          <Text>{marker}</Text>
          <Box flexDirection="column" flexShrink={1} gap={1}>
            {drawn}
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
    const post = e.module.endsWith('reply.tsx') ? replyPostOf(e.data) : undefined
    if (post === undefined) return next(e)
    if (post.mounted === true) await noteDrawn($, e.requestId)
    await update($, memberOf(openStretches, { requestId: `${e.requestId}#${e.element}` }), () => post.open)
    const { opened } = post
    if (opened !== undefined) await update($, seen, list => record(list, e.requestId, opened.short))

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

/** A reply as desktop markdown: each closed stretch a link, each open one its long form then a «. */
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
      return `[${labelOf(part.short)}](${href})`
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
  const mounted = 'mounted' in data && data.mounted === true ? ({ mounted: true } as const) : {}
  const opened: unknown = 'opened' in data ? data.opened : undefined
  if (typeof opened !== 'object' || opened === null || !('short' in opened) || !('key' in opened)) return { open, ...mounted }
  const { short, key } = opened

  return typeof short === 'string' && typeof key === 'string' ? { open, opened: { short, key }, ...mounted } : { open, ...mounted }
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
