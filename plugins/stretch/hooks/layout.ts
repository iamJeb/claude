// Adapted from cc-stretch (https://github.com/pro-vi/cc-stretch), MIT License, Copyright (c) 2026 pro-vi.
// See ../LICENSE-cc-stretch.

// Lays out a paragraph that holds stretches, for a Client to draw: its markdown as rows of styled
// runs, wrapped to the region's width, so a press can be matched to the phrase under it. Claude
// Code draws every paragraph without a stretch with its own markdown.

import { isRule } from './parse'

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
}

export type Row = Run[]

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
const TAB_STOP = 4
const TAB = String.fromCharCode(9)
const MARKDOWN_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/y
// What inline() treats as more than text: the phrase marks, code, emphasis and links.
const INLINE_SPECIAL = /[\ufdd0\ufdd2`*[]/

/** `text` without the noncharacters the layout uses as marks. */
export function stripMarkers(text: string): string {
  return text.replace(/[\ufdd0-\ufdef]/g, '')
}

/** A line's text without its tint marks, and the tint of each character left. */
type Line = { text: string; tints: (string | undefined)[] }

/** `word` drawn in `colour`. */
export function tint(colour: string, word: string): string {
  return `${TINT}${colour}${SEP}${word}${TINT_END}`
}

/** Whether a word is markdown syntax rather than text: a bullet, a list number, a rule, a fence, a pipe, a heading mark. */
export function isMarkup(word: string): boolean {
  return !/[\p{L}\p{N}]/u.test(word) || /^\d+[.)]$/.test(word) || /^(`{3,}|~{3,})/.test(word)
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
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(marked)?.[1]
    if (fence !== undefined && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = undefined
      continue
    }
    if (fence === undefined && marker !== undefined) {
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
  const clean = rows.map(row => row.map(run => ({ ...run, text: stripMarkers(run.text) })).filter(run => run.text !== ''))
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

/**
 * A line without its tint marks, so its markdown is read from the text alone: a stretch tints the
 * words it adds one at a time, so a code span or a link label can hold several. A space takes the
 * tint before it, so a tinted phrase stays one run. A tab becomes spaces to the next stop of four.
 */
function untint(marked: string): Line {
  // Most lines carry no tint and no tab: nothing to do.
  if (!marked.includes(TINT) && !marked.includes(TAB)) return { text: marked, tints: [] }
  let text = ''
  const tints: Line['tints'] = []
  let tinted: string | undefined
  for (let i = 0; i < marked.length; i++) {
    const ch = marked[i] ?? ''
    const sep = ch === TINT ? marked.indexOf(SEP, i + 1) : -1
    if (sep !== -1) {
      tinted = marked.slice(i + 1, sep)
      i = sep
    } else if (ch === TINT_END) {
      tinted = undefined
    } else if (ch === '\t') {
      const spaces = TAB_STOP - (widthOf(stripMarkers(text)) % TAB_STOP)
      for (let k = 0; k < spaces; k++) tints.push(tinted ?? tints.at(-1))
      text += ' '.repeat(spaces)
    } else {
      tints.push(ch === ' ' && tinted === undefined ? tints.at(-1) : tinted)
      text += ch
    }
  }

  return { text, tints }
}

function rowsOf({ text: line, tints }: Line, width: number): Row[] {
  // The runs of the line's end from `rest` on.
  const inlineOf = (rest: string, isBold = false) => inline(rest, tints.slice(line.length - rest.length), isBold)
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
 * character in its tint. A markdown link's label is read the same way, so a stretch inside it stays
 * pressable and its marks never show.
 */
function inline(text: string, tints: Line['tints'], isBold = false, outer: Run['link'] = undefined, extraAll: Omit<Run, 'text'> = {}): Run[] {
  const runs: Run[] = []
  let bold = isBold
  let italic = false
  let pressable: Run['link'] = outer
  // `chunk` starts at character `at`, and takes its tint.
  const emit = (chunk: string, at: number, extra: Omit<Run, 'text'> = {}) => {
    if (chunk === '') return
    const tint = tints[at]
    const run: Run = {
      text: chunk,
      ...(bold && { bold: true }),
      ...(italic && { italic: true }),
      ...(tint && { tint }),
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
      const labelRuns = inline(label, tints.slice(i + 1), bold, pressable, { ...extraAll, underline: true, ...(italic && { italic: true }) })
      labelRuns.forEach(push)
      emit(` (${stripMarkers(markdownLink[2] ?? '')})`, i + markdownLink[0].length - 1, { dim: true })
      i += markdownLink[0].length
      continue
    }
    // Plain text up to the next character that means something here, or the next change of tint,
    // in one piece. A surrogate pair is never special, so a cluster is not split between runs.
    let stop = i + 1
    while (stop < text.length && !INLINE_SPECIAL.test(text[stop] ?? '') && tints[stop] === tints[i]) stop += 1
    emit(text.slice(i, stop), i)
    i = stop
  }

  return runs
}

/** Word-wraps runs into rows of `width` cells; the first row starts with `first`, later rows with `rest`. */
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
  const breakRow = () => {
    const last = row.at(-1)
    if (last !== undefined && !isBare) {
      last.text = last.text.trimEnd()
      if (last.text === '') row.pop()
    }
    rows.push(row)
    begin(rest)
  }

  begin(first)
  for (const run of runs) {
    for (const text of run.text.split(/( +)/)) {
      if (text === '') continue
      if (text.trim() === '') {
        if (isBare) continue
        if (used + widthOf(text) <= width) put({ ...run, text })
        else breakRow()
        continue
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
    }
  }
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
    a.link?.action === b.link?.action && a.link?.key === b.link?.key
  )
}
