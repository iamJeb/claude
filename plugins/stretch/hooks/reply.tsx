// Adapted from cc-stretch (https://github.com/pro-vi/cc-stretch), MIT License, Copyright (c) 2026 pro-vi.
// See ../LICENSE-cc-stretch.

import type { ClientModule, ClientSurface, TextProps } from 'claude-code'

import { grow, lengthOf } from './grow'
import { isMarkup, layout, link, linkAt, stripMarkers, tint } from './layout'
import type { Row, Run } from './layout'
import { closeAfter, isLinkable, KEY_SEPARATOR, parse, stretches, writeOpen } from './parse'
import type { Segment, Stretch } from './parse'

// Draws one paragraph of a reply that holds stretches. It runs where the reader's screen draws it,
// so a press answers at once and the growth moves on the screen's own frame clock. What the reader
// opens is posted to the hooks module, which keeps it across redraws, notes it for Claude and picks
// its colour.

/**
 * The colours of an open stretch: of the words it added (faded unless it is the newest) and of its
 * closer, which never fades, as a faded closer reads as disabled.
 */
export type Tint = { words: string; closer: string }

/** An open-all or close-all from the /stretch command, numbered so the instance applies each once. */
export type Bulk = { id: number; action: 'open' | 'close' }

/**
 * The paragraph, the stretches the reader already has open in it, the tint of each, and the latest
 * open-all or close-all aimed at its reply.
 */
export type ReplyProps = { text: string; open: string[]; tints: Record<string, Tint>; bulk?: Bulk }

/**
 * What the instance posts to the hooks module: the open stretches whenever they change, with the
 * stretch the reader just opened (its short form for the note to Claude, its key for its colour),
 * the short forms an open-all opened, and once on its first draw, `mounted`, so the hooks module
 * knows the reply was drawn.
 */
export type ReplyPost = { open: string[]; opened?: { short: string; key: string }; openedAll?: string[]; mounted?: true }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
// `bulk`: the id of the last open-all or close-all applied, or of the one standing at the first draw.
type State = { open: string[]; growth: Growth | null; bulk: number }

const FRAME_MS = 16

// A drawn tree must stay within 100,000 serialized characters and 20,000 nodes, or the engine
// unmounts the instance. Past these estimates the paragraph is drawn open as markdown instead.
const MAX_SERIALIZED = 60_000
const MAX_NODES = 12_000
const MAX_MARKDOWN = 90_000
const ANIMATE_MAX_CHARS = 4_000

/** What one instance has worked out, kept so a frame of a growth does not parse or lay out again. */
type Cache = {
  text: string
  segments: Segment[]
  composed: string
  columns: number
  rows: Row[]
}
const caches = new WeakMap<object, Cache>()

const Reply: ClientModule<ReplyProps, State> = (props, surface) => {
  const { Box, Text, Markdown } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ open: props.open, growth: null, bulk: props.bulk?.id ?? 0 })
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') press(surface, event.x, event.y)
    })
    surface.every(FRAME_MS, () => tick(surface))
    surface.post({ open: props.open, mounted: true } satisfies ReplyPost)
  }
  let state = surface.state ?? { open: props.open, growth: null, bulk: props.bulk?.id ?? 0 }
  const columns = surface.columns > 0 ? surface.columns : 80
  let cache = caches.get(surface)
  if (cache === undefined || cache.text !== props.text) {
    const segments = parse(stripMarkers(props.text))
    cache = { text: props.text, segments, composed: '', columns: -1, rows: [] }
    caches.set(surface, cache)
  }
  // An open-all opens every stretch of the paragraph at once, nested ones too; a close-all closes them.
  const { bulk } = props
  if (bulk !== undefined && bulk.id !== state.bulk) {
    const all = stretches(cache.segments).filter(isLinkable)
    const open = bulk.action === 'open' ? all.map(stretch => stretch.key) : []
    const opened = all.filter(stretch => !state.open.includes(stretch.key)).map(stretch => stretch.short.trim())
    state = { open, growth: null, bulk: bulk.id }
    surface.setState(state)
    surface.post(bulk.action === 'open' && opened.length > 0 ? ({ open, openedAll: opened } satisfies ReplyPost) : ({ open } satisfies ReplyPost))
  }
  const composed = compose(cache.segments, state, props.tints)
  if (composed !== cache.composed || columns !== cache.columns) {
    cache.rows = layout(composed, columns)
    cache.composed = composed
    cache.columns = columns
  }
  const { rows } = cache

  if (!fitsTree(rows)) {
    const open = writeOpen(cache.segments)
    return <Markdown text={open.length > MAX_MARKDOWN ? `${open.slice(0, MAX_MARKDOWN)}…` : open} />
  }

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">{row.length === 0 ? ' ' : row.map(run => (isPlain(run) ? run.text : <Text {...styleOf(run)}>{run.text}</Text>))}</Text>
      ))}
    </Box>
  )
}

export default Reply

/** Whether the rows, drawn, stay well inside the engine's bounds for one tree. */
export function fitsTree(rows: Row[]): boolean {
  let size = 40
  let nodes = 1
  for (const row of rows) {
    size += 40
    nodes += 1
    for (const run of row) {
      // A string child costs its text and quotes; a styled run is a node with its props as well.
      size += JSON.stringify(run.text).length + 2
      if (!isPlain(run)) {
        size += JSON.stringify(styleOf(run)).length + 40
        nodes += 1
      }
    }
    if (size > MAX_SERIALIZED || nodes > MAX_NODES) return false
  }

  return true
}

/**
 * The paragraph as the reader sees it now: closed stretches as pressable short forms, open ones in
 * full then a «, the words each added in its tint.
 */
function compose(segments: Segment[], state: State, tints: Record<string, Tint>): string {
  const write = (parts: Segment[]): string => parts.map(part => (typeof part === 'string' ? part : draw(part))).join('')
  const draw = (stretch: Stretch): string => {
    if (stretch.long === undefined || !stretch.isClosed) return stretch.short
    // A short form over several lines is drawn open.
    if (!isLinkable(stretch)) return write(stretch.long)
    const colours = tints[stretch.key]
    const paint = (word: string) => (colours === undefined || isMarkup(word) ? word : tint(colours.words, word))
    if (state.growth?.key === stretch.key) return grow(stretch.short, stretch.long, easeInOut(state.growth.progress), draw, paint)
    if (!state.open.includes(stretch.key)) return link('open', stretch.key, stretch.short)
    const closer = link('close', stretch.key, '«')
    const long = grow(stretch.short, stretch.long, 1, draw, paint)
    return closeAfter(long, colours === undefined ? closer : tint(colours.closer, closer), '\n')
  }

  return write(segments)
}

function press(surface: ClientSurface<State>, x: number, y: number) {
  const state = surface.state
  const shown = caches.get(surface)
  if (state === undefined || shown === undefined) return
  const target = linkAt(shown.rows, x, y)
  if (target === undefined) return
  const stretch = stretches(shown.segments).find(one => one.key === target.key)
  if (stretch?.long === undefined) return

  // A stretch still shrinking when another press lands is closed at once.
  const open = state.growth !== null && !state.growth.isOpening ? closed(state.open, state.growth.key) : state.open
  // A long paragraph opens and closes at once: laying it out every frame would cost more than a frame.
  if (shown.text.length > ANIMATE_MAX_CHARS) {
    const next = target.action === 'open' ? [...open.filter(key => key !== stretch.key), stretch.key] : closed(open, stretch.key)
    surface.setState({ ...state, open: next, growth: null })
    surface.post(
      target.action === 'open' ? ({ open: next, opened: { short: stretch.short.trim(), key: stretch.key } } satisfies ReplyPost) : ({ open: next } satisfies ReplyPost),
    )
    return
  }
  const duration = 1000 * Math.min(1.4, 0.45 + lengthOf(stretch.long) / 70)
  if (target.action === 'open') {
    const next = [...open.filter(key => key !== stretch.key), stretch.key]
    surface.setState({ ...state, open: next, growth: { key: stretch.key, isOpening: true, progress: 0, duration } })
    surface.post({ open: next, opened: { short: stretch.short.trim(), key: stretch.key } } satisfies ReplyPost)
  } else {
    surface.setState({ ...state, open, growth: { key: stretch.key, isOpening: false, progress: 1, duration } })
  }
}

function tick(surface: ClientSurface<State>) {
  const state = surface.state
  if (state?.growth == null) return
  const { growth } = state
  const progress = growth.progress + ((growth.isOpening ? 1 : -1) * FRAME_MS) / growth.duration
  if (progress > 0 && progress < 1) {
    surface.setState({ ...state, growth: { ...growth, progress } })
    return
  }
  // A shrunk stretch, and every stretch inside it, leaves the open list as its growth ends.
  const open = growth.isOpening ? state.open : closed(state.open, growth.key)
  surface.setState({ ...state, open, growth: null })
  if (!growth.isOpening) surface.post({ open } satisfies ReplyPost)
}

function closed(open: string[], key: string): string[] {
  return open.filter(k => k !== key && !k.startsWith(`${key}${KEY_SEPARATOR}`))
}

function isPlain(run: Run): boolean {
  return !run.bold && !run.italic && !run.underline && !run.dim && run.tint === undefined && !run.code && run.link === undefined
}

function styleOf(run: Run): TextProps {
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.underline && { underline: true }),
    ...(run.dim && { dimColor: true }),
    // A colour that is not a plain hex value is dropped rather than handed to the screen.
    ...(run.tint !== undefined && /^#[0-9a-fA-F]{6}$/.test(run.tint) && { color: run.tint }),
    ...(run.code && { color: 'permission' }),
    // Underlined, in the text's own colour, marks what a press acts on, leaving colour to code and
    // to the words a click added. A closer is tinted like them, in its stretch's unfaded colour.
    ...(run.link && { underline: true }),
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}
