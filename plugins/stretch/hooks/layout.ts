// Lays out a paragraph that holds stretches, for a Client to draw: its markdown as rows of styled
// runs, wrapped to the region's width, so a press can be matched to the phrase under it. Claude
// Code draws every paragraph without a stretch with its own markdown.

import { closesFence, isLinkable, isRule, openingFence } from './parse'
import type { Segment, Stretch } from './parse'

/** What a press on a pressable phrase does to its stretch. */
export type Action = 'open' | 'close'

export type Run = {
  text: string
  bold?: true
  italic?: true
  code?: true
  underline?: true
  dim?: true
  /** The colour of the words a stretch added. */
  tint?: string
  link?: { action: Action; key: string }
  /** Where a markdown link or a bare URL goes, drawn as a hyperlink. */
  href?: string
}

export type Row = Run[]

/** How a row a line wrapped onto joins the row before it: what the break took out, and the lead's cells. */
export type Continuation = { join: string; lead: number }

// The rows a line wrapped onto, so a copy of several rows gives back the line as written.
const continuations = new WeakMap<Row, Continuation>()

/** How `row` continues the row before it, if a line wrapped onto it. */
export function continuationOf(row: Row): Continuation | undefined {
  return continuations.get(row)
}

// Unicode noncharacters frame a pressable phrase or a tinted word in composed text. Private-use
// characters are not used, because Nerd Font icons live there and a reply can hold them. A reply's
// own noncharacters are removed before composing (stripMarkers), every reader of the marks below
// treats a mark without its partner as plain text, and the finished rows are stripped once more, so
// a mark never reaches the screen.
const START = '\ufdd0'
const SEP = '\ufdd1'
const END = '\ufdd2'
const TINT = '\ufdd3'
const TINT_END = '\ufdd4'
const DIM = '\ufdd5'
const DIM_END = '\ufdd6'
const TAB_STOP = 4
const TAB = String.fromCharCode(9)
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/y
// What inline() treats as more than text: the phrase marks, code, emphasis and links.
const INLINE_SPECIAL = /[\ufdd0\ufdd2`*[]/

/** `text` without the noncharacters the layout uses as marks. */
export function stripMarkers(text: string): string {
  return text.replace(/[\ufdd0-\ufdef]/g, '')
}

/** The tint of each character of a line, and whether it is drawn dim, once the marks are read out. */
type Marks = { tints: (string | undefined)[]; dims: boolean[] }

/** A line's text without its tint and dim marks, and the marks of each character left. */
type Line = { text: string } & Marks

/** `word` drawn in `colour`. */
export function tint(colour: string, word: string): string {
  return `${TINT}${colour}${SEP}${word}${TINT_END}`
}

/** `word` drawn dim, inside a link as much as outside one. */
export function dim(word: string): string {
  return `${DIM}${word}${DIM_END}`
}

/** Whether a word is markdown syntax rather than text: a bullet, a list number, a rule, a fence, a pipe, a heading mark. */
export function isMarkup(word: string): boolean {
  return !/[\p{L}\p{N}]/u.test(word) || /^\d+[.)]$/.test(word) || openingFence(word) !== undefined
}

/** A pressable phrase for composed text: drawn as `label`, a press does `action` to stretch `key`. */
export function link(action: Action, key: string, label: string): string {
  return `${START}${action}${SEP}${key}${SEP}${label}${END}`
}

/** The rows `text` takes in a region `columns` cells wide. No row is wider than that. */
export function layout(text: string, columns: number): Row[] {
  const width = Math.max(10, columns)
  const rows: Row[] = []
  let fence: string | undefined
  for (const marked of text.split('\n')) {
    // A fence is read from the line's text alone, as the parser reads it: a line such as ```python
    // inside a block starts with the marker but does not close the block.
    const bare = stripMarkers(marked)
    if (fence !== undefined && closesFence(bare, fence)) {
      fence = undefined
      continue
    }
    const marker = fence === undefined ? openingFence(bare) : undefined
    if (marker !== undefined) {
      fence = marker
      continue
    }
    rows.push(...lineRows(marked, width, fence !== undefined))
  }

  return rows
}

// Rows of a line already laid out, by width, fence and text: a frame of a growth changes few
// lines, so the rest are not laid out again. Cleared when it grows past its bound.
const lineCache = new Map<string, Row[]>()
const LINE_CACHE_MAX_CHARS = 2_000_000
let lineCacheChars = 0

function lineRows(marked: string, width: number, isInFence: boolean): Row[] {
  const key = `${width}|${isInFence ? 'f' : 't'}|${marked}`
  const cached = lineCache.get(key)
  if (cached !== undefined) return cached
  const line = untint(marked)
  const rows = isInFence ? cutRows([{ text: `  ${line.text}`, code: true }], width) : rowsOf(line, width)
  const clean = rows.map(row => {
    const stripped = row.map(run => ({ ...run, text: stripMarkers(run.text) })).filter(run => run.text !== '')
    // The rows a line wrapped onto keep how they join, which a copy across them reads.
    const continuation = continuations.get(row)
    if (continuation !== undefined) continuations.set(stripped, continuation)
    return stripped
  })
  if (lineCacheChars + key.length > LINE_CACHE_MAX_CHARS) {
    lineCache.clear()
    lineCacheChars = 0
  }
  lineCache.set(key, clean)
  lineCacheChars += key.length

  return clean
}

/**
 * The phrase drawn at cell `x` of row `y`, if any. A one-cell `«` is hard to land on, so a press
 * a cell beside a closer counts as on it.
 */
export function linkAt(rows: Row[], x: number, y: number): Run['link'] {
  const spans: { from: number; to: number; link: Run['link'] }[] = []
  let at = 0
  for (const run of rows[y] ?? []) {
    const w = widthOf(run.text)
    spans.push({ from: at, to: at + w, link: run.link })
    at += w
  }
  const exact = spans.find(span => x >= span.from && x < span.to)?.link
  if (exact !== undefined) return exact

  return spans.find(span => span.link?.action === 'close' && x >= span.from - 1 && x < span.to + 1)?.link
}

/**
 * Whether a ctrl- or alt-click opens a hyperlink to `href`: a web page does, and a `file:` link,
 * which could name a program behind its words, is left to the terminal's own click.
 */
export function isWebLink(href: string): boolean {
  return /^https?:/.test(href)
}

/** Where the hyperlink drawn at cell `x` of row `y` goes, if one is drawn there. */
export function hrefAt(rows: Row[], x: number, y: number): string | undefined {
  let at = 0
  for (const run of rows[y] ?? []) {
    const w = widthOf(run.text)
    if (x >= at && x < at + w) return run.href
    at += w
  }

  return undefined
}

/**
 * The stretches `action` acts on among those drawn, with the stretches in `open` open: to open, those
 * drawn as links with every stretch around them open; to close, those open, whose « is drawn. A short
 * form over several lines is drawn open with no «, so the stretches inside it are drawn.
 */
export function targetsIn(parts: Segment[], open: readonly string[], action: Action): Stretch[] {
  return parts.flatMap(part => {
    if (typeof part === 'string' || part.long === undefined || !part.isClosed) return []
    if (!isLinkable(part)) return targetsIn(part.long, open, action)
    if (!open.includes(part.key)) return action === 'open' ? [part] : []
    return [...(action === 'close' ? [part] : []), ...targetsIn(part.long, open, action)]
  })
}

// Terminal cell widths, measured per grapheme cluster, which is what the reader sees as one character.
const ZERO_WIDTH = /^[\p{M}\u200b-\u200f\u2060-\u2064\ufe00-\ufe0f\ufeff\u{e0100}-\u{e01ef}\ufdd0-\ufdef]$/u
const EMOJI_PRESENTATION = /\p{Emoji_Presentation}/u
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u
type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> }
type SegmenterClass = new (locale?: string, options?: { granularity: 'grapheme' }) => GraphemeSegmenter
const segmenter: GraphemeSegmenter | undefined = (() => {
  try {
    const Segmenter = (Intl as unknown as { Segmenter?: SegmenterClass }).Segmenter
    return Segmenter === undefined ? undefined : new Segmenter(undefined, { granularity: 'grapheme' })
  } catch {
    return undefined
  }
})()

/** The grapheme clusters of `text`; without Intl.Segmenter, code points with marks, joiners and selectors kept on the one before. */
export function graphemes(text: string): string[] {
  if (segmenter !== undefined) return Array.from(segmenter.segment(text), part => part.segment)
  const out: string[] = []
  let isJoined = false
  for (const ch of text) {
    const last = out.length - 1
    if (last >= 0 && (isJoined || ZERO_WIDTH.test(ch))) {
      out[last] += ch
      isJoined = ch === '\u200d'
    } else {
      out.push(ch)
      isJoined = false
    }
  }

  return out
}

function isWideCodePoint(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0x303e) || (c >= 0x3041 && c <= 0x33ff) ||
    (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa000 && c <= 0xa4cf) ||
    (c >= 0xa960 && c <= 0xa97f) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1b000 && c <= 0x1b2ff) || (c >= 0x1f200 && c <= 0x1f2ff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}

/** Cells one grapheme cluster takes: 0 for marks, joiners and selectors alone; 2 for wide East Asian characters and emoji shown as emoji; else 1. */
export function clusterWidth(cluster: string): number {
  const points = Array.from(cluster)
  if (points.length === 0 || points.every(ch => ZERO_WIDTH.test(ch))) return 0
  if (EMOJI_PRESENTATION.test(cluster)) return 2
  if ((cluster.includes('\ufe0f') || cluster.includes('\u200d')) && PICTOGRAPHIC.test(cluster)) return 2

  return isWideCodePoint(points[0]?.codePointAt(0) ?? 0) ? 2 : 1
}

/** Cells a string takes on a terminal, summed over its grapheme clusters. */
export function widthOf(text: string): number {
  // Printable ASCII is one cell a character, which is most text.
  if (/^[\x20-\x7e]*$/.test(text)) return text.length
  let cells = 0
  for (const cluster of graphemes(text)) cells += clusterWidth(cluster)

  return cells
}

// Where a row may break in text without spaces. Chinese and Japanese break between any two
// characters. Korean spaces its words, so it breaks at spaces as Latin text does. Thai, Lao, Khmer
// and Burmese write words without spaces, and a row breaks between words where Intl.Segmenter
// finds them. Closing punctuation, a Japanese small kana, the long-vowel mark and a mark drawn on
// the letter before it never start a row; opening punctuation never ends one.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}　-〿＀-￯]/u
const SEGMENTED = /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u
const NO_START = /[\p{Pe}\p{Pf},.:;!?，。、；：？！…·ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーゝゞヽヾ々]/u
const NO_END = /[\p{Ps}\p{Pi}]/u
type WordSegmenter = { segment(text: string): Iterable<{ segment: string; index: number }> }
type WordSegmenterClass = new (locale?: string, options?: { granularity: 'word' }) => WordSegmenter
const wordSegmenter: WordSegmenter | undefined = (() => {
  try {
    const Segmenter = (Intl as unknown as { Segmenter?: WordSegmenterClass }).Segmenter
    return Segmenter === undefined ? undefined : new Segmenter(undefined, { granularity: 'word' })
  } catch {
    return undefined
  }
})()

/**
 * One part of a line split at spaces, cut into the pieces a row may break between and growth adds
 * one at a time; a run of spaces stays whole.
 */
export function breakables(text: string): string[] {
  // Nothing below Thai breaks, so a Latin word or a run of spaces comes back whole without a look at
  // each character.
  if (!/[^\0-෿]/.test(text)) return [text]
  const wordStarts = new Set<number>()
  if (wordSegmenter !== undefined && SEGMENTED.test(text)) for (const word of wordSegmenter.segment(text)) wordStarts.add(word.index)
  const pieces: string[] = []
  let piece = ''
  let last = ''
  let isAfterUnspaced = false
  let at = 0
  for (const ch of text) {
    const isUnspaced = UNSPACED.test(ch)
    const isWordStart = wordStarts.has(at) && SEGMENTED.test(last + ch)
    if (piece !== '' && (isUnspaced || isAfterUnspaced || isWordStart) && !NO_START.test(ch) && !NO_END.test(last) && !ZERO_WIDTH.test(ch)) {
      pieces.push(piece)
      piece = ''
    }
    piece += ch
    last = ch
    isAfterUnspaced = isUnspaced || (isAfterUnspaced && NO_START.test(ch))
    at += ch.length
  }
  if (piece !== '') pieces.push(piece)

  return pieces
}

/**
 * A line without its tint and dim marks, so its markdown is read from the text alone: a stretch
 * tints the words it adds one at a time, so a code span or a link label can hold several. A space
 * takes the tint before it, so a tinted phrase stays one run. A tab becomes spaces to the next stop
 * of four.
 */
function untint(marked: string): Line {
  // Most lines carry no tint, no dim mark and no tab: nothing to do.
  if (!marked.includes(TINT) && !marked.includes(DIM) && !marked.includes(TAB)) return { text: marked, tints: [], dims: [] }
  let text = ''
  const tints: Line['tints'] = []
  const dims: Line['dims'] = []
  let tinted: string | undefined
  let isDim = false
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i] ?? ''
    const sep = ch === TINT ? marked.indexOf(SEP, i + 1) : -1
    if (sep !== -1) {
      tinted = marked.slice(i + 1, sep)
      i = sep
    } else if (ch === TINT_END) {
      tinted = undefined
    } else if (ch === DIM) {
      isDim = true
    } else if (ch === DIM_END) {
      isDim = false
    } else if (ch === '\t') {
      const spaces = TAB_STOP - (widthOf(stripMarkers(text)) % TAB_STOP)
      for (let k = 0; k < spaces; k++) {
        tints.push(tinted ?? tints.at(-1))
        dims.push(isDim)
      }
      text += ' '.repeat(spaces)
    } else {
      tints.push(ch === ' ' && tinted === undefined ? tints.at(-1) : tinted)
      dims.push(isDim)
      text += ch
    }
  }

  return { text, tints, dims }
}

/** The marks of a line from character `from` on. */
function marksFrom({ tints, dims }: Marks, from: number): Marks {
  return { tints: tints.slice(from), dims: dims.slice(from) }
}

function rowsOf({ text: line, tints, dims }: Line, width: number): Row[] {
  // The runs of the line's end from `rest` on.
  const inlineOf = (rest: string, isBold = false) => inline(rest, marksFrom({ tints, dims }, line.length - rest.length), isBold)
  if (line.trim() === '') return [[]]
  if (isRule(line)) return [[{ text: '─'.repeat(Math.min(width, 60)), dim: true }]]
  // A table row keeps its columns: written as is, cut where the region ends.
  if (/^\s*\|/.test(line)) return cutRows(inlineOf(line), width)
  const heading = /^#{1,6}\s+(.*)$/.exec(line)
  if (heading) return wrap(inlineOf(heading[1] ?? '', true), width, '', '')
  const quote = /^>\s?(.*)$/.exec(line)
  if (quote) return wrap(inlineOf(quote[1] ?? ''), width, '▎ ', '▎ ', true)
  const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
  if (item) {
    const lead = `${item[1] ?? ''}${item[2] ?? ''} `
    return wrap(inlineOf(item[3] ?? ''), width, lead, ' '.repeat(widthOf(lead)))
  }
  const indent = /^\s*/.exec(line)?.[0] ?? ''

  return wrap(inlineOf(line.slice(indent.length)), width, indent, indent)
}

/**
 * A line's inline markdown as runs: bold, italic, code spans, links, pressable phrases, each
 * character in its tint and dimmed where marked. A markdown link's label is read the same way, so a
 * stretch inside it stays pressable and its marks never show.
 */
function inline(text: string, marks: Marks, isBold = false, outer: Run['link'] = undefined, extraAll: Omit<Run, 'text'> = {}): Run[] {
  const { tints, dims } = marks
  const runs: Run[] = []
  let bold = isBold
  let italic = false
  let pressable: Run['link'] = outer
  // `chunk` starts at character `at`, and takes its tint and dimness.
  const emit = (chunk: string, at: number, extra: Omit<Run, 'text'> = {}) => {
    if (chunk === '') return
    const tint = tints[at]
    const run: Run = {
      text: chunk,
      ...(bold && { bold: true }),
      ...(italic && { italic: true }),
      ...(tint && { tint }),
      ...(dims[at] === true && { dim: true }),
      ...(pressable && { link: pressable }),
      ...extraAll,
      ...extra,
    }
    push(run)
  }
  const push = (run: Run) => {
    const last = runs.at(-1)
    if (last !== undefined && isSameStyle(last, run)) last.text += run.text
    else runs.push(run)
  }

  for (let i = 0; i < text.length; ) {
    const ch = text[i] ?? ''
    const first = ch === START ? text.indexOf(SEP, i + 1) : -1
    const second = first === -1 ? -1 : text.indexOf(SEP, first + 1)
    if (second !== -1) {
      pressable = { action: text.slice(i + 1, first) === 'close' ? 'close' : 'open', key: text.slice(first + 1, second) }
      i = second + 1
      continue
    }
    if (ch === END) {
      pressable = outer
      i += 1
      continue
    }
    if (ch === '`') {
      let stop = i
      while (text[stop] === '`') stop += 1
      const fence = text.slice(i, stop)
      const end = text.indexOf(fence, i + fence.length)
      if (end !== -1) {
        emit(stripMarkers(text.slice(i + fence.length, end)), i + fence.length, { code: true })
        i = end + fence.length
        continue
      }
    }
    if (text.startsWith('**', i)) {
      bold = !bold
      i += 2
      continue
    }
    if (ch === '*' && /\S/.test((italic ? text[i - 1] : text[i + 1]) ?? ' ')) {
      italic = !italic
      i += 1
      continue
    }
    MARKDOWN_LINK.lastIndex = i
    const markdownLink = ch === '[' ? MARKDOWN_LINK.exec(text) : null
    if (markdownLink) {
      const label = markdownLink[1] ?? ''
      const href = stripMarkers(markdownLink[2] ?? '')
      // A target that opens the same from any folder is drawn as a hyperlink; any other keeps its
      // target beside its label. Claude Code 2.1.302's own markdown links a relative path too.
      const isFollowed = /^(https?|file):/.test(href)
      const labelRuns = inline(label, marksFrom(marks, i + 1), bold, pressable, { ...extraAll, ...(isFollowed ? { href } : { underline: true }), ...(italic && { italic: true }) })
      labelRuns.forEach(push)
      if (!isFollowed) emit(` (${href})`, i + markdownLink[0].length - 1, { dim: true })
      i += markdownLink[0].length
      continue
    }
    // Plain text up to the next character that means something here, or the next change of tint
    // or dimness, in one piece. A surrogate pair is never special, so a cluster is not split
    // between runs.
    let stop = i + 1
    while (stop < text.length && !INLINE_SPECIAL.test(text[stop] ?? '') && tints[stop] === tints[i] && dims[stop] === dims[i]) stop += 1
    // A bare URL inside the piece is drawn as a hyperlink, the text before it as it is.
    const scheme = URL_SCHEME.exec(text.slice(i, stop))
    const urlAt = scheme === null || (scheme.index === 0 && /\w/.test(text[i - 1] ?? ' ')) ? -1 : i + scheme.index
    const url = urlAt === -1 ? undefined : bareUrlAt(text, urlAt)
    if (url !== undefined) {
      emit(text.slice(i, urlAt), i)
      emit(url, urlAt, { href: url })
      i = urlAt + url.length
      continue
    }
    emit(text.slice(i, stop), i)
    i = stop
  }

  return runs
}

// Where an `http:` or `https:` URL may start inside a piece of plain text: not inside a word.
const URL_SCHEME = /(?<!\w)https?:\/\//

/**
 * The `http:` or `https:` URL written at `at`, without punctuation that ends the sentence after it
 * or a closing bracket it did not open.
 */
function bareUrlAt(text: string, at: number): string | undefined {
  let url = /^https?:\/\/[^\s<>`﷐-﷯]+/.exec(text.slice(at))?.[0]
  if (url === undefined) return undefined
  for (;;) {
    const opened = url.split('(').length - 1
    const closed = url.split(')').length - 1
    if (/[.,;:!?'"*_]$/.test(url) || (url.endsWith(')') && closed > opened)) url = url.slice(0, -1)
    else break
  }

  return /^https?:\/\/[^/]/.test(url) ? url : undefined
}

/**
 * Wraps runs into rows of `width` cells, breaking at spaces and, in text without them, where
 * `breakables` allows; the first row starts with `first`, later rows with `rest`.
 */
function wrap(runs: Run[], width: number, first: string, rest: string, isDimLead = false): Row[] {
  const rows: Row[] = []
  let row: Row = []
  let used = 0
  let isBare = true
  const begin = (lead: string) => {
    row = lead === '' ? [] : [{ text: lead, ...(isDimLead && { dim: true }) }]
    used = widthOf(lead)
    isBare = true
  }
  const put = (piece: Run) => {
    const last = row.at(-1)
    if (last !== undefined && isSameStyle(last, piece)) last.text += piece.text
    else row.push({ ...piece })
    used += widthOf(piece.text)
    isBare = false
  }
  // The row ends here and the next begins; `isAtSpace` when the break stands for a space the line
  // wrote, which a copy across the two rows puts back.
  const breakRow = (isAtSpace = false) => {
    const last = row.at(-1)
    let join = isAtSpace ? ' ' : ''
    if (last !== undefined && !isBare) {
      const trimmed = last.text.trimEnd()
      if (trimmed !== last.text) join = ' '
      last.text = trimmed
      if (last.text === '') row.pop()
    }
    rows.push(row)
    begin(rest)
    continuations.set(row, { join, lead: used })
  }

  begin(first)
  // Each part is a run of spaces or a piece of a word: a word in text without spaces is cut where
  // `breakables` lets a row break, and every piece after the first `isBreakable` from the one before.
  const parts = runs.flatMap(run =>
    run.text
      .split(/( +)/)
      .filter(text => text !== '')
      .flatMap(text => (text.trim() === '' ? [{ run, text, isBreakable: false }] : breakables(text).map((piece, i) => ({ run, text: piece, isBreakable: i > 0 })))),
  )
  const isWord = (at: number) => (parts[at]?.text.trim() ?? '') !== ''
  parts.forEach(({ run, text, isBreakable }, at) => {
    if (!isWord(at)) {
      if (isBare) return
      if (used + widthOf(text) <= width) put({ ...run, text })
      else breakRow(true)
      return
    }
    // Pieces that touch with no space between and no break allowed between them, such as a link
    // and the » or full stop after it, read as one word, so a row that cannot take them all breaks
    // before the first.
    if (!isBare && (!isWord(at - 1) || isBreakable)) {
      let whole = 0
      for (let k = at; isWord(k) && (k === at || parts[k]?.isBreakable !== true); k++) whole += widthOf(parts[k]?.text ?? '')
      if (used + whole > width && whole <= width - widthOf(rest)) breakRow()
    }
    let word = text
    while (word !== '') {
      if (used + widthOf(word) <= width) {
        put({ ...run, text: word })
        break
      }
      if (!isBare) {
        breakRow()
        continue
      }
      // A word wider than a whole row is cut where the row ends; a row always takes one cluster.
      const [head, tail] = cut(word, width - used, true)
      put({ ...run, text: head })
      breakRow()
      word = tail
    }
  })
  rows.push(row)

  return rows
}

/** Rows of text kept as written, cut every `width` cells. */
function cutRows(runs: Run[], width: number): Row[] {
  const rows: Row[] = []
  let row: Row = []
  let used = 0
  for (const run of runs) {
    let rest = run.text
    while (rest !== '') {
      const [head, tail] = cut(rest, width - used, used === 0)
      if (head === '') {
        rows.push(row)
        row = []
        used = 0
        continuations.set(row, { join: '', lead: 0 })
        continue
      }
      row.push({ ...run, text: head })
      used += widthOf(head)
      rest = tail
    }
  }
  rows.push(row)

  return rows
}

/**
 * `text` split by grapheme cluster where it would pass `room` cells. With `force`, the head keeps at
 * least one cluster, so a caller that starts a fresh row always moves forward.
 */
function cut(text: string, room: number, force: boolean): [string, string] {
  const clusters = graphemes(text)
  let used = 0
  let count = 0
  for (const cluster of clusters) {
    const w = clusterWidth(cluster)
    if (used + w > room && !(force && count === 0)) break
    used += w
    count += 1
  }

  return [clusters.slice(0, count).join(''), clusters.slice(count).join('')]
}

function isSameStyle(a: Run, b: Run): boolean {
  return (
    a.bold === b.bold && a.italic === b.italic && a.code === b.code && a.underline === b.underline && a.dim === b.dim && a.tint === b.tint &&
    a.link?.action === b.link?.action && a.link?.key === b.link?.key && a.href === b.href
  )
}
