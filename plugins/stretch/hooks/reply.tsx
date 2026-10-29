import type { ClientModule, ClientPointerEvent, ClientSurface, TextProps } from 'claude-code'

import type { Hex } from './contrast'
import { grow, lengthOf } from './grow'
import { continuationOf, dim, graphemes, hrefAt, isMarkup, isWebLink, layout, link, linkAt, stripMarkers, targetsIn, tint, widthOf } from './layout'
import type { Action, Row, Run } from './layout'
import { DEFAULT_LOOK, drawsHighlight, lookProps } from './look'
import type { DrawnLook } from './look'
import { closeAfter, hasNested, isLinkable, KEY_SEPARATOR, NESTED_MARK, parse, stretches, writeOpen } from './parse'
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

/** A stretch the reader asked to open or close from the keyboard, numbered so each ask acts once. */
export type Ask = { key: string; action: Action; n: number }

/** While letters show: whether typing one opens or closes, and the letter of each stretch they cover. */
export type Letters = { action: Action; keys: Record<string, string> }

/**
 * The paragraph, the stretches the reader already has open in it, the tint of each, the latest
 * open-all or close-all aimed at its reply, the last ask from the keyboard, its letters, how
 * pressable phrases look, and under the tinted highlight each stretch's own highlight, by key, in
 * place of the look's.
 */
export type ReplyProps = {
  text: string
  open: string[]
  tints: Record<string, Tint>
  bulk?: Bulk
  ask?: Ask | null
  letters?: Letters | null
  look?: DrawnLook
  highlights?: Record<string, Hex>
}

/**
 * What the instance posts to the hooks module: the open stretches whenever they change, with the
 * stretch the reader just opened (its short form for the note to Claude, its key for its colour),
 * the short forms an open-all opened, and once on its first draw, `mounted`, so the hooks module
 * knows the reply was drawn.
 */
export type ReplyPost = { open: string[]; opened?: { short: string; key: string }; openedAll?: string[]; mounted?: true }

/** What the instance posts when the reader drags across its text: the text, for the clipboard. */
export type CopyPost = { copy: string }

/** What the instance posts when the reader ctrl- or alt-clicks a hyperlink: where it goes, for the hooks module to open. */
export type FollowPost = { follow: string }

/**
 * A run as drawn: a letter over the first character of a short form or a «, or the rest of that
 * text after it; or text the reader dragged across.
 */
type DrawnRun = Run & { isLetter?: true; isAfterLetter?: true; isSelected?: true }

type Growth = { key: string; isOpening: boolean; progress: number; duration: number }
type Cell = { x: number; y: number }
/**
 * Text the reader dragged across: from the cell the press went down on to the one under the pointer.
 * A word picked by a double-click covers both its ends, even when they are the same cell. `link` is
 * the link the press went down on, which its release acts on unless the pointer `hasMoved` to another
 * cell first or the release itself lands on another cell. `follow` is the web link a ctrl- or
 * alt-press went down on, which its release opens on the same terms.
 */
type Selection = { anchor: Cell; head: Cell; isDragging: boolean; isWord?: true; link?: Run['link']; follow?: string; hasMoved?: true }
/**
 * One cell a double-click looks through for a word: what it shows, and where. `startsApart` marks
 * the first cell of a row that no word runs onto from the row before.
 */
type WordCell = { segment: string; x: number; y: number; width: number; startsApart?: true }
/**
 * What is open, what is growing, the id of the last open-all or close-all applied (or of the one
 * standing at the first draw), the number of the last ask acted on, and what the reader selected.
 */
type State = { open: string[]; growth: Growth | null; bulk: number; asked: number; selection: Selection | null }

const FRAME_MS = 16
// Two presses make a double-click when the second comes less than this long after the first and at
// most this many cells from it, across and down: the limits of Claude Code 2.1.303's own double-click,
// so a paragraph that holds a stretch answers like the paragraphs around it.
const DOUBLE_CLICK_MS = 500
const DOUBLE_CLICK_CELLS = 1
// What a double-click takes as one word: Claude Code 2.1.303's own word characters, and `#` as well,
// so that `#12806` comes out whole. A colon joins a word only when a slash or a backslash follows it,
// so that a drive letter (`C:\Users`) and a scheme (`ssh://host`) stay with what they lead.
const WORD = /[\p{L}\p{N}_/.\-+~\\#]/u
const AFTER_COLON = /^[/\\]$/
// What a URL is made of: as Claude Code 2.1.303's own double-click does, a URL is taken from its
// scheme on, whatever style it is drawn in.
const IN_URL = /^(?![<>"'`])[!-~]$/
// What a URL does not end on: the punctuation after it, and a closing bracket it does not open.
const AFTER_URL = '.,;:!?'
const OPENERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

// A drawn tree must stay within 100,000 serialized characters and 20,000 nodes, or the engine
// unmounts the instance. Past these estimates the paragraph is drawn open as markdown instead.
const MAX_SERIALIZED = 60_000
const MAX_NODES = 12_000
const MAX_MARKDOWN = 90_000
const ANIMATE_MAX_CHARS = 4_000

/**
 * What one instance has worked out, kept so a frame of a growth does not parse or lay out again:
 * the rows as laid out, and as drawn with any letters over them, which a press is matched against.
 */
type Cache = {
  text: string
  segments: Segment[]
  composed: string
  columns: number
  rows: Row[]
  lettered: DrawnRun[][]
}
const caches = new WeakMap<object, Cache>()
// The last ask each instance was handed, acted on at its next frame rather than while drawing.
const asks = new WeakMap<object, Ask>()
// The last press each instance saw, where and when it went down, so the next press soon after and
// close by makes a double-click. It is dropped by the double-click itself, so a quick third press
// is a single click that takes the word down; when its release lands on another cell, so two quick
// drags from one cell stay two drags; and when a stretch opens or closes, which ends a double-click
// begun before it.
const presses = new WeakMap<object, Cell & { at: number }>()

const Reply: ClientModule<ReplyProps, State> = (props, surface) => {
  const { Box, Link, Text, Markdown } = surface.elements
  // An ask made before this instance was drawn is not acted on again.
  const fresh: State = { open: props.open, growth: null, bulk: props.bulk?.id ?? 0, asked: props.ask?.n ?? 0, selection: null }
  if (surface.state === undefined) {
    surface.setState(fresh)
    surface.onPointer(event => pointer(surface, event))
    surface.every(FRAME_MS, () => tick(surface))
    surface.post({ open: props.open, mounted: true } satisfies ReplyPost)
  }
  // A paragraph drawn by an earlier version of this module keeps its old state and props after a
  // reload, without the ask, the letters or the selection.
  const ask = props.ask ?? null
  const letters = props.letters ?? null
  if (ask !== null) asks.set(surface, ask)
  let state: State = { ...fresh, ...surface.state }
  const columns = surface.columns > 0 ? surface.columns : 80
  let cache = caches.get(surface)
  if (cache === undefined || cache.text !== props.text) {
    const segments = parse(stripMarkers(props.text))
    cache = { text: props.text, segments, composed: '', columns: -1, rows: [], lettered: [] }
    caches.set(surface, cache)
  }
  // An open-all opens every stretch of the paragraph at once, nested ones too; a close-all closes them.
  const { bulk } = props
  if (bulk !== undefined && bulk.id !== state.bulk) {
    const all = stretches(cache.segments).filter(isLinkable)
    const open = bulk.action === 'open' ? all.map(stretch => stretch.key) : []
    const opened = all.filter(stretch => !state.open.includes(stretch.key)).map(stretch => stretch.short.trim())
    state = { ...state, open, growth: null, bulk: bulk.id, selection: null }
    surface.setState(state)
    surface.post(bulk.action === 'open' && opened.length > 0 ? ({ open, openedAll: opened } satisfies ReplyPost) : ({ open } satisfies ReplyPost))
  }
  const composed = compose(cache.segments, state, props.tints)
  if (composed !== cache.composed || columns !== cache.columns) {
    cache.rows = layout(composed, columns)
    cache.composed = composed
    cache.columns = columns
  }
  cache.lettered = lettered(cache.rows, letters)
  const rows = state.selection === null ? cache.lettered : selected(cache.lettered, cache.rows, state.selection)
  // A paragraph drawn by an earlier version of this module is handed its old props, without the look
  // or the highlights, and is drawn as that version drew it.
  const look = props.look ?? DEFAULT_LOOK
  // Read through a Map, which holds own keys only: a stretch keyed `constructor` must not find Object's.
  const highlights = new Map(Object.entries(props.highlights ?? {}))
  const lookFor = (run: DrawnRun): DrawnLook => {
    const highlight = run.link && highlights.get(run.link.key)
    return highlight === undefined ? look : { ...look, highlight }
  }

  if (!fitsTree(rows, lookFor)) {
    const open = writeOpen(cache.segments)
    return <Markdown text={open.length > MAX_MARKDOWN ? `${open.slice(0, MAX_MARKDOWN)}…` : open} />
  }

  return (
    <Box flexDirection="column">
      {rows.map(row => (
        <Text wrap="truncate">
          {row.length === 0
            ? ' '
            : row.map(run => {
                if (isPlain(run)) return run.text
                const piece = <Text {...styleOf(run, lookFor(run))}>{run.text}</Text>
                return run.href === undefined ? piece : <Link href={run.href}>{piece}</Link>
              })}
        </Text>
      ))}
    </Box>
  )
}

export default Reply

/** Whether the rows, drawn with the look `lookFor` gives each run, stay well inside the engine's bounds for one tree. */
export function fitsTree(rows: Row[], lookFor: (run: DrawnRun) => DrawnLook = () => DEFAULT_LOOK): boolean {
  let size = 40
  let nodes = 1
  for (const row of rows) {
    size += 40
    nodes += 1
    for (const run of row) {
      // A string child costs its text and quotes; a styled run is a node with its props as well,
      // and a hyperlink wraps it in one more.
      size += JSON.stringify(run.text).length + 2
      if (!isPlain(run)) {
        size += JSON.stringify(styleOf(run, lookFor(run))).length + 40
        nodes += 1
      }
      if (run.href !== undefined) {
        size += run.href.length + 40
        nodes += 1
      }
    }
    if (size > MAX_SERIALIZED || nodes > MAX_NODES) return false
  }

  return true
}

/**
 * The paragraph as the reader sees it now: closed stretches as pressable short forms, open ones in
 * full then a «, the words each added in its tint. A closed stretch whose long form holds another
 * ends in a dim », inside the link, so the reader sees that a click goes deeper.
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
    if (!state.open.includes(stretch.key)) return link('open', stretch.key, hasNested(stretch) ? `${stretch.short}${dim(NESTED_MARK)}` : stretch.short)
    const closer = link('close', stretch.key, '«')
    const long = grow(stretch.short, stretch.long, 1, draw, paint)
    return closeAfter(long, colours === undefined ? closer : tint(colours.closer, closer), '\n')
  }

  return write(segments)
}

/**
 * The rows with each letter drawn over the first character of what a press on its stretch acts on,
 * its short form or its «, so nothing on screen moves; the rest of that text is marked.
 */
function lettered(rows: Row[], letters: Letters | null): DrawnRun[][] {
  if (letters === null) return rows
  // Read through a Map, which holds own keys only: a stretch keyed `constructor` must not find Object's.
  const keys = new Map(Object.entries(letters.keys))
  const done = new Set<string>()
  return rows.map(row =>
    row.flatMap((run): DrawnRun[] => {
      const { link } = run
      const letter = link?.action === letters.action ? keys.get(link.key) : undefined
      if (link === undefined || letter === undefined) return [run]
      if (done.has(link.key)) return [{ ...run, isAfterLetter: true }]
      done.add(link.key)
      const first = graphemes(run.text)[0]
      if (first === undefined) return [run]
      const rest = run.text.slice(first.length)
      // A letter takes one cell, so a wide first character keeps its second cell as a space.
      const cover: DrawnRun = { ...run, text: widthOf(first) > 1 ? `${letter} ` : letter, isLetter: true }
      return rest === '' ? [cover] : [cover, { ...run, text: rest, isAfterLetter: true }]
    }),
  )
}

/**
 * A click on a short form or a « opens or closes its stretch as the button comes up. As of Claude
 * Code 2.1.302 a Client holds the pointer from a press until its release and the transcript selects
 * nothing meanwhile, so a drag from anywhere, a link included, selects here: the cells it crosses
 * are highlighted, and on release their text goes to the clipboard. A double-click selects here too,
 * taking the URL or word under it at once, except on a short form or a «, which the first click
 * acted on. A ctrl- or alt-click on a web link posts it for the hooks module to open as the button
 * comes up, and a ctrl- or alt-drag from one selects; away from a web link either acts as a plain one.
 */
function pointer(surface: ClientSurface<State>, event: ClientPointerEvent) {
  const state = surface.state
  const shown = caches.get(surface)
  if (state === undefined || shown === undefined) return
  const { selection } = state
  if (event.type === 'down' && event.button === 'left') {
    const href = event.ctrl === true || event.alt === true ? hrefAt(shown.lettered, event.x, event.y) : undefined
    const follow = href !== undefined && isWebLink(href) ? href : undefined
    // A web link inside a short form is the link's under ctrl or alt, not the stretch's.
    const target = follow === undefined ? linkAt(shown.lettered, event.x, event.y) : undefined
    const cell = clamped(shown.lettered, event)
    const at = performance.now()
    const last = presses.get(surface)
    const isDouble =
      last !== undefined && at - last.at < DOUBLE_CLICK_MS && Math.abs(cell.x - last.x) <= DOUBLE_CLICK_CELLS && Math.abs(cell.y - last.y) <= DOUBLE_CLICK_CELLS
    // A double-click picks a word in text, not on a short form or a «.
    const word = follow === undefined && isDouble && target === undefined ? wordAt(shown.rows, cell) : undefined
    if (isDouble) presses.delete(surface)
    else presses.set(surface, { ...cell, at })
    if (word !== undefined) {
      const picked: Selection = { ...word, isDragging: false, isWord: true }
      surface.setState({ ...state, selection: picked })
      const text = textIn(shown.rows, picked)
      if (text !== '') surface.post({ copy: text } satisfies CopyPost)
      return
    }
    surface.setState({ ...state, selection: { anchor: cell, head: cell, isDragging: true, ...(target !== undefined && { link: target }), ...(follow !== undefined && { follow }) } })
    return
  }
  // A selection left on screen goes once the pointer moves off the paragraph: as of Claude Code
  // 2.1.302 a press elsewhere does not reach this instance to take it down.
  if (event.type === 'leave' && selection?.isDragging === false) {
    surface.setState({ ...state, selection: null })
    return
  }
  if (selection?.isDragging !== true) return
  if (event.type === 'move') {
    const head = clamped(shown.lettered, event)
    if (head.x === selection.head.x && head.y === selection.head.y) return
    surface.setState({ ...state, selection: { ...selection, head, hasMoved: true } })
    return
  }
  if (event.type !== 'up') return
  const { link: pressed, follow } = selection
  // A press that moved to another cell, or whose release lands on one, was a drag, which selects;
  // one that did not is a click on its link. The release is read against the press itself, since a
  // button let go on another cell may reach here with no move event between.
  const released = clamped(shown.lettered, event)
  const isClick = selection.hasMoved !== true && released.x === selection.anchor.x && released.y === selection.anchor.y
  if (follow !== undefined && isClick) {
    surface.setState({ ...state, selection: null })
    surface.post({ follow } satisfies FollowPost)
    return
  }
  if (pressed !== undefined && isClick) {
    surface.setState({ ...state, selection: null })
    openOrClose(surface, pressed.action, pressed.key)
    return
  }
  const text = textIn(shown.rows, selection)
  if (text !== '' || selection.anchor.x !== selection.head.x || selection.anchor.y !== selection.head.y) presses.delete(surface)
  // A click (a press that moved nowhere) takes a selection down, and so does a release off the
  // paragraph, which as of Claude Code 2.1.302 no leave follows.
  const isOff = event.x < 0 || event.y < 0 || event.x >= surface.columns || event.y >= shown.lettered.length
  surface.setState({ ...state, selection: text === '' || isOff ? null : { ...selection, isDragging: false } })
  if (text !== '') surface.post({ copy: text } satisfies CopyPost)
}

/** The cell under the pointer, kept to the rows drawn: above them is their start, below them their end. */
function clamped(rows: Row[], { x, y }: Cell): Cell {
  if (y < 0) return { x: 0, y: 0 }
  if (y >= rows.length) return { x: Number.POSITIVE_INFINITY, y: Math.max(0, rows.length - 1) }
  return { x: Math.max(0, x), y }
}

/** The selection's first and last cells in reading order, both selected; none when it covers no cell. */
function span({ anchor, head, isWord }: Selection): { from: Cell; to: Cell } | undefined {
  if (anchor.x === head.x && anchor.y === head.y && isWord !== true) return undefined
  const isForward = anchor.y < head.y || (anchor.y === head.y && anchor.x < head.x)
  return isForward ? { from: anchor, to: head } : { from: head, to: anchor }
}

/**
 * The URL or the word around cell `at` as a selection's two ends, its first and last cells, which a
 * line wrapped inside it puts on different rows; none when the cell is in no URL and holds no word
 * character, so a double-click on a space or a comma picks nothing.
 */
function wordAt(rows: Row[], at: Cell): { anchor: Cell; head: Cell } | undefined {
  const cells = cellsIn(rows)
  const hit = cells.findIndex(cell => cell.y === at.y && at.x >= cell.x && at.x < cell.x + Math.max(1, cell.width))
  const ends = urlAround(cells, hit) ?? wordAround(cells, hit)
  const first = ends && cells[ends[0]]
  const last = ends && cells[ends[1]]
  if (first === undefined || last === undefined) return undefined
  return { anchor: { x: first.x, y: first.y }, head: { x: last.x + Math.max(1, last.width) - 1, y: last.y } }
}

/**
 * Every cell of `rows` in reading order, without the lead a wrapped line's later rows start with. A
 * row starts apart from the one before unless a line wrapped onto it inside a word.
 */
function cellsIn(rows: Row[]): WordCell[] {
  const cells: WordCell[] = []
  rows.forEach((row, y) => {
    const continuation = continuationOf(row)
    let x = 0
    for (const run of row) {
      for (const segment of graphemes(run.text)) {
        const width = widthOf(segment)
        if (x >= (continuation?.lead ?? 0)) {
          const isApart = cells.at(-1)?.y !== y && continuation?.join !== ''
          cells.push({ segment, x, y, width, ...(isApart && { startsApart: true }) })
        }
        x += width
      }
    }
  })
  return cells
}

/** The first and last of the cells around `hit` that `isIn` holds for, by their place in `cells`, within one line. */
function around(cells: WordCell[], hit: number, isIn: (at: number) => boolean): [number, number] {
  let first = hit
  let last = hit
  while (cells[first]?.startsApart !== true && isIn(first - 1)) first -= 1
  while (cells[last + 1]?.startsApart !== true && isIn(last + 1)) last += 1
  return [first, last]
}

/**
 * The URL around cell `hit`: its run of URL characters, cut at the last scheme at or before it and
 * the next scheme after it, less what a URL does not end on; none when `hit` is in no URL.
 */
function urlAround(cells: WordCell[], hit: number): [number, number] | undefined {
  const isInUrl = (at: number) => IN_URL.test(cells[at]?.segment ?? '')
  if (!isInUrl(hit)) return undefined
  const [first, last] = around(cells, hit, isInUrl)
  // Each cell of the run holds one character, so a place in its text is a place among its cells.
  const text = cells.slice(first, last + 1).map(cell => cell.segment).join('')
  const offset = hit - first
  const starts = [...text.matchAll(/(?:https?|file):\/\//g)].map(match => match.index)
  const from = starts.findLast(start => start <= offset)
  if (from === undefined) return undefined
  let url = text.slice(from, starts.find(start => start > offset))
  while (url !== '') {
    const end = url.slice(-1)
    const opener = OPENERS[end]
    const isUnopened = opener !== undefined && url.split(end).length > url.split(opener).length
    if (!AFTER_URL.includes(end) && !isUnopened) break
    url = url.slice(0, -1)
  }
  return offset < from + url.length ? [first + from, first + from + url.length - 1] : undefined
}

/**
 * The run of word characters around cell `hit`, a colon with a slash or a backslash after it
 * included, without the full stops it ends on unless it is nothing else; none when `hit` holds no
 * word character.
 */
function wordAround(cells: WordCell[], hit: number): [number, number] | undefined {
  const isWord = (at: number) => {
    const segment = cells[at]?.segment ?? ''
    return WORD.test(segment) || (segment === ':' && AFTER_COLON.test(cells[at + 1]?.segment ?? ''))
  }
  if (!isWord(hit)) return undefined
  const [first, last] = around(cells, hit, isWord)
  const isStop = (at: number) => cells[at]?.segment === '.'
  let end = last
  while (end > first && isStop(end)) end -= 1
  return [first, isStop(end) ? last : end]
}

/**
 * The columns of `row`, row `y`, a selection covers, from the first to the last, both included. A row
 * a line wrapped onto is covered after its lead, as the line itself had none there.
 */
function columnsOf(y: number, row: Row, { from, to }: { from: Cell; to: Cell }): [number, number] | undefined {
  if (y < from.y || y > to.y) return undefined
  const lead = continuationOf(row)?.lead ?? 0
  return [Math.max(y === from.y ? from.x : 0, lead), y === to.y ? to.x : Number.POSITIVE_INFINITY]
}

/**
 * Each run of `rows` with the part a selection covers split out and marked, character by character:
 * the cells `textIn` copies. `laid` is `rows` before letters were drawn over them, which is where a
 * wrapped row's lead is recorded.
 */
function selected(rows: DrawnRun[][], laid: Row[], selection: Selection): DrawnRun[][] {
  const covered = span(selection)
  if (covered === undefined) return rows
  return rows.map((row, y) => {
    const columns = columnsOf(y, laid[y] ?? [], covered)
    if (columns === undefined) return row
    const [first, last] = columns
    const out: DrawnRun[] = []
    let at = 0
    for (const run of row) {
      let piece: DrawnRun | undefined
      for (const segment of graphemes(run.text)) {
        const isSelected = at >= first && at <= last
        if (piece !== undefined && (piece.isSelected === true) === isSelected) piece.text += segment
        else {
          piece = { ...run, text: segment, ...(isSelected && { isSelected: true }) }
          out.push(piece)
        }
        at += widthOf(segment)
      }
    }
    return out
  })
}

/**
 * The text a selection covers, as the reader would paste it: a line wrapped over several rows joined
 * back into one, without the lead its later rows start with, and each line's trailing spaces gone.
 */
function textIn(rows: Row[], selection: Selection): string {
  const covered = span(selection)
  if (covered === undefined) return ''
  let text = ''
  for (let y = covered.from.y; y <= covered.to.y; y += 1) {
    const row = rows[y] ?? []
    const [start, last] = columnsOf(y, row, covered) ?? [0, Number.POSITIVE_INFINITY]
    const continuation = continuationOf(row)
    let piece = ''
    let at = 0
    for (const run of row) {
      for (const segment of graphemes(run.text)) {
        if (at >= start && at <= last) piece += segment
        at += widthOf(segment)
      }
    }
    if (y > covered.from.y) text = continuation === undefined ? `${text.trimEnd()}\n` : `${text}${continuation.join}`
    text += piece
  }

  return text.trimEnd()
}

/**
 * Opens or closes stretch `key` as a press on it does; false when no link on screen does that, as
 * for a letter the hooks gave a stretch still growing open, whose « is not drawn yet.
 */
function openOrClose(surface: ClientSurface<State>, action: Action, key: string, asked?: number): boolean {
  const state = surface.state
  const shown = caches.get(surface)
  if (state === undefined || shown === undefined || !hasLink(shown.rows, action, key)) return false

  // A stretch still shrinking when another press lands is closed at once, so what can be pressed is
  // judged without it: a press inside it, or a letter put up before it closed, does nothing.
  const open = state.growth !== null && !state.growth.isOpening ? closed(state.open, state.growth.key) : state.open
  const stretch = targetsIn(shown.segments, open, action).find(one => one.key === key)
  if (stretch?.long === undefined) return false
  const acted = asked ?? state.asked
  const opened = { short: stretch.short.trim(), key: stretch.key }
  // A long paragraph opens and closes at once: laying it out every frame would cost more than a frame.
  if (shown.text.length > ANIMATE_MAX_CHARS) {
    const next = action === 'open' ? [...open.filter(k => k !== stretch.key), stretch.key] : closed(open, stretch.key)
    surface.setState({ ...state, open: next, growth: null, asked: acted, selection: null })
    surface.post(action === 'open' ? ({ open: next, opened } satisfies ReplyPost) : ({ open: next } satisfies ReplyPost))
    presses.delete(surface)
    return true
  }
  const duration = 1000 * Math.min(1.4, 0.45 + lengthOf(stretch.long) / 70)
  if (action === 'open') {
    const next = [...open.filter(k => k !== stretch.key), stretch.key]
    surface.setState({ ...state, open: next, growth: { key: stretch.key, isOpening: true, progress: 0, duration }, asked: acted, selection: null })
    surface.post({ open: next, opened } satisfies ReplyPost)
  } else {
    surface.setState({ ...state, open, growth: { key: stretch.key, isOpening: false, progress: 1, duration }, asked: acted, selection: null })
  }
  presses.delete(surface)

  return true
}

function tick(surface: ClientSurface<State>) {
  const state = surface.state
  const ask = asks.get(surface)
  if (state !== undefined && ask !== undefined && ask.n > state.asked) {
    // The ask is spent with no change when its stretch cannot be pressed for it.
    if (!openOrClose(surface, ask.action, ask.key, ask.n)) surface.setState({ ...state, asked: ask.n })
    return
  }
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

/** Whether `rows` draw a link that does `action` to stretch `key`. */
function hasLink(rows: Row[], action: Action, key: string): boolean {
  return rows.some(row => row.some(run => run.link?.action === action && run.link.key === key))
}

function closed(open: string[], key: string): string[] {
  return open.filter(k => k !== key && !k.startsWith(`${key}${KEY_SEPARATOR}`))
}

function isPlain(run: DrawnRun): boolean {
  return (
    !run.bold && !run.italic && !run.underline && !run.dim && run.tint === undefined && !run.code && run.link === undefined &&
    run.href === undefined && !run.isLetter && !run.isAfterLetter && !run.isSelected
  )
}

function styleOf(run: DrawnRun, look: DrawnLook): TextProps {
  // A phrase a press acts on carries the look: underlined in the text's own colour by default,
  // leaving colour to code, to the words a click added and to a hyperlink inside the phrase. A
  // closer is tinted like those words, in its stretch's unfaded colour.
  const isPlainText = !run.tint && !run.code && run.href === undefined
  // While a letter covers the phrase, the rest of it keeps a highlight drawn on it, so a tinted one
  // still shows the colour the stretch opens in; any other part is drawn in inverse text on the
  // permission colour, underlined whatever the look.
  const isOnPermission = run.isAfterLetter && !drawsHighlight(look, isPlainText)
  const looked = run.link && !run.isLetter && !isOnPermission ? lookProps(look, isPlainText, run.dim) : undefined
  return {
    ...(run.bold && { bold: true }),
    ...(run.italic && { italic: true }),
    ...(run.underline && { underline: true }),
    // A pressable run's own dim, such as a link target's or the », is drawn by lookProps, which knows the highlight.
    ...(run.dim && looked === undefined && { dimColor: true }),
    // A colour that is not a plain hex value is dropped rather than handed to the screen.
    ...(run.tint !== undefined && /^#[0-9a-fA-F]{6}$/.test(run.tint) && { color: run.tint }),
    ...(run.code && { color: 'permission' }),
    ...(run.link && (looked ?? { underline: true })),
    // A hyperlink is underlined in the suggestion colour, so it is not read as a stretch to press.
    ...(run.href !== undefined && { underline: true, color: 'suggestion' }),
    ...(isOnPermission && { color: 'inverseText', backgroundColor: 'permission' }),
    // The letter itself is drawn bold in inverse text on the theme's error colour.
    ...(run.isLetter && { color: 'inverseText', backgroundColor: 'error', bold: true }),
    // Text the reader dragged across is drawn inverse, as a terminal draws its own selection.
    ...(run.isSelected && { inverse: true }),
  }
}

function easeInOut(k: number): number {
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
}
