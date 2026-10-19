// Adapted from cc-stretch (https://github.com/pro-vi/cc-stretch), MIT License, Copyright (c) 2026 pro-vi.
// See ../LICENSE-cc-stretch.

// A reply is markdown in which `{{short|long}}` marks a stretch: the reader sees `short`, and
// opening it puts `long` in its place. `long` may hold further stretches. Code spans and fences are
// copied as written, so braces in code never open a stretch.
//
// Only well-formed markup becomes a stretch. These stay literal text: a `{{` followed by
// whitespace or another brace, or written as `${{` (`{{ name }}`, `${{ secrets.TOKEN }}`); a `{{`
// that never closes; braces closed with no `|`; and a long form that reads as template syntax, a
// single token with no space or one with `=` before its first space (`{{name|upper}}`,
// `{{cite web|url=...}}`). An empty long form leaves the short form as plain text, and an empty
// short form leaves the long form as plain text. A stretch used as a section label (alone on its
// line, its short form no sentence) is written open, its long form as plain text.

export type Segment = string | Stretch

export type Stretch = {
  /**
   * Names the stretch by its position: its index among the stretches beside it, after its parents'
   * (`0 › 1`), so no text a reply writes can make two keys collide.
   */
  key: string
  short: string
  long: Segment[] | undefined
  isClosed: boolean
}

type Frame = { stretch: Stretch; start: number; bar: number }

export const KEY_SEPARATOR = ' › '

/** Line endings as the parser and the layout read them: CRLF and lone CR become LF. */
export function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

export function isOpenable(stretch: Stretch): boolean {
  return stretch.isClosed && stretch.long !== undefined
}

/** Whether a stretch is drawn as a link: openable, with its short form on one line, as a link cannot span lines. */
export function isLinkable(stretch: Stretch): boolean {
  return isOpenable(stretch) && !stretch.short.includes('\n')
}

/**
 * An open stretch's long form followed by its `closer`, after a space, or after `gap` when the long
 * form ends in a line text after it would change: a rule, which then reads as plain dashes, or a code
 * fence, which then no longer closes.
 */
export function closeAfter(long: string, closer: string, gap: string): string {
  const trimmed = long.trimEnd()
  const last = trimmed.slice(trimmed.lastIndexOf('\n') + 1)
  const endsInBlock = isRule(last) || /^ {0,3}(?:`{3,}|~{3,})[ \t]*$/.test(last)

  return endsInBlock ? `${trimmed}${gap}${closer}` : `${long} ${closer}`
}

/** Whether `line` is a rule: three or more of one of `-`, `*` and `_`, spaces between allowed. */
export function isRule(line: string): boolean {
  return /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)
}

/** The key of the stretch holding the one keyed `key`, or '' when no stretch holds it. */
export function parentOf(key: string): string {
  return key.split(KEY_SEPARATOR).slice(0, -1).join(KEY_SEPARATOR)
}

/**
 * Where the code span opening at `i` ends: past the next run of as many backticks in the same
 * paragraph. An unmatched run is literal backticks and ends right after itself.
 */
export function codeSpanEnd(text: string, i: number): number {
  let stop = i
  while (text[stop] === '`') stop += 1
  const run = text.slice(i, Math.max(stop, i + 1))
  const end = text.indexOf(run, i + run.length)
  const blankLine = /\n[ \t]*\n/g
  blankLine.lastIndex = i + run.length
  const blank = blankLine.exec(text)
  const paragraphEnd = blank === null ? text.length : blank.index
  if (end === -1 || end > paragraphEnd) return i + run.length

  return end + run.length
}

/** Whether a `{{` at `i` may open a stretch: not after `$`, and followed by a character that is neither space nor brace. */
function opensAt(text: string, i: number): boolean {
  if (!text.startsWith('{{', i) || text[i - 1] === '$') return false
  const after = text[i + 2]

  return after !== undefined && /[^\s{}]/.test(after)
}

/**
 * Whether a long form, as written, reads as template syntax rather than prose: a single token with
 * no space (`upper`, `currency`), or one with `=` before its first space (`url=...`).
 */
function isTemplateLong(raw: string): boolean {
  const space = raw.search(/\s/)
  if (space === -1) return true

  return raw.slice(0, space).includes('=')
}

type Parsed = { root: Segment[]; rejected: [number, number][]; spans: [number, number][] }

/**
 * One pass. `literal` maps the start of each `{{` to be read as text to the position of the `}}`
 * closing it (-1 for none), which is read as text too. Returns the stretches found unclosed or
 * template-like, as [start, close], to be made literal on the next pass.
 */
function parseOnce(text: string, literal: ReadonlyMap<number, number>): Parsed {
  const literalCloses = new Set([...literal.values()].filter(at => at >= 0))
  const root: Segment[] = []
  const stack: Frame[] = []
  const spans: [number, number][] = []
  const rejected: [number, number][] = []

  const containerOf = (frame: Frame | undefined) => frame?.stretch.long ?? root
  const write = (chunk: string) => {
    if (chunk === '') return
    const frame = stack.at(-1)
    if (frame && frame.stretch.long === undefined) {
      frame.stretch.short += chunk
      return
    }
    const segments = containerOf(frame)
    const last = segments.at(-1)
    if (typeof last === 'string') segments[segments.length - 1] = last + chunk
    else segments.push(chunk)
  }
  const put = (segment: Segment) => (typeof segment === 'string' ? write(segment) : containerOf(stack.at(-1)).push(segment))

  let i = 0
  while (i < text.length) {
    const frame = stack.at(-1)
    const isInShort = frame !== undefined && frame.stretch.long === undefined

    const fenceStop = i === 0 || text[i - 1] === '\n' ? fenceEnd(text, i) : undefined
    if (fenceStop !== undefined) {
      write(text.slice(i, fenceStop))
      i = fenceStop
      continue
    }

    if (text[i] === '`') {
      const stop = codeSpanEnd(text, i)
      write(text.slice(i, stop))
      i = stop
      continue
    }

    if (text.startsWith('{{', i) && (!isInShort || (!literal.has(i) && opensAt(text, i)))) {
      if (literal.has(i) || !opensAt(text, i)) {
        write('{{')
        i += 2
        continue
      }
      // A short form holds no stretch: a stretch opening inside one means the outer `{{` was text.
      if (isInShort) {
        stack.pop()
        containerOf(stack.at(-1)).pop()
        write(`{{${frame.stretch.short}`)
      }
      const stretch: Stretch = { key: '', short: '', long: undefined, isClosed: false }
      containerOf(stack.at(-1)).push(stretch)
      stack.push({ stretch, start: i, bar: -1 })
      i += 2
      continue
    }

    if (isInShort && text[i] === '|') {
      frame.stretch.long = []
      frame.bar = i
      i += 1
      continue
    }

    if (text.startsWith('}}', i) && literalCloses.has(i)) {
      write('}}')
      i += 2
      continue
    }

    if (frame && text.startsWith('}}', i)) {
      stack.pop()
      // The stretch is the last segment of its container: everything since went inside it.
      containerOf(stack.at(-1)).pop()
      const { short, long } = frame.stretch
      const isLongEmpty = long !== undefined && long.every(part => typeof part === 'string' && part.trim() === '')
      if (long === undefined) write(`{{${short}}}`)
      else if (short.trim() === '') long.forEach(put)
      else if (isLongEmpty) write(short)
      else {
        if (isTemplateLong(text.slice(frame.bar + 1, i))) rejected.push([frame.start, i])
        frame.stretch.isClosed = true
        containerOf(stack.at(-1)).push(frame.stretch)
        spans.push([frame.start, i + 2])
      }
      i += 2
      continue
    }

    write(text[i] ?? '')
    i += 1
  }
  for (const open of stack) rejected.push([open.start, -1])

  return { root, rejected, spans }
}

/** Parses until nothing is rejected; each rejected `{{` and its `}}` are made literal and the text read again. */
function parseFull(input: string): { root: Segment[]; spans: [number, number][] } {
  const text = normalize(input)
  const literal = new Map<number, number>()
  for (;;) {
    const parsed = parseOnce(text, literal)
    if (parsed.rejected.length === 0) {
      assignKeys(parsed.root, undefined)
      return parsed
    }
    for (const [start, close] of parsed.rejected) literal.set(start, close)
  }
}

export function parse(text: string): Segment[] {
  return openLabels(parseFull(text).root, true, true)
}

// What may stand beside a label on its line: a quote mark, a bullet or list number, a heading's
// hashes and emphasis before it; emphasis and a colon, either way round, after it.
const LABEL_HEAD = /^[ \t]*(?:>[ \t]*)*(?:(?:[-+*]|\d+[.)])[ \t]+)?(?:#{1,6}[ \t]+)?[*_]*[ \t]*$/
const LABEL_TAIL = /^[ \t]*(?:[*_]*:?|:?[*_]*)[ \t]*$/

/**
 * `segments` with each stretch used as a label written open: its long form in its place, no link.
 * A label is a stretch alone on its line (a paragraph of its own included) whose short form does
 * not read as a sentence: a question or one ending in a colon is a label there. The start and end
 * of the reply are line edges; a long form's are not.
 */
function openLabels(segments: Segment[], isAtLineStart: boolean, isAtLineEnd: boolean): Segment[] {
  const out: Segment[] = []
  const push = (part: Segment) => {
    const last = out.at(-1)
    if (typeof part === 'string' && typeof last === 'string') out[out.length - 1] = last + part
    else out.push(part)
  }
  // The text between the stretch at `i` and the edge of its line, or null when another stretch or
  // the edge of a long form lies between.
  const headOf = (i: number): string | null => {
    const prev = segments[i - 1]
    if (prev === undefined) return isAtLineStart ? '' : null
    if (typeof prev !== 'string') return null
    if (prev.includes('\n')) return prev.slice(prev.lastIndexOf('\n') + 1)
    return i - 1 === 0 && isAtLineStart ? prev : null
  }
  const tailOf = (i: number): string | null => {
    const next = segments[i + 1]
    if (next === undefined) return isAtLineEnd ? '' : null
    if (typeof next !== 'string') return null
    if (next.includes('\n')) return next.slice(0, next.indexOf('\n'))
    return i + 1 === segments.length - 1 && isAtLineEnd ? next : null
  }

  segments.forEach((part, i) => {
    if (typeof part === 'string' || !isOpenable(part) || part.long === undefined) {
      push(part)
      return
    }
    part.long = openLabels(part.long, false, false)
    const head = headOf(i)
    const tail = tailOf(i)
    const isAlone = head !== null && tail !== null && LABEL_HEAD.test(head) && LABEL_TAIL.test(tail)
    if (isAlone && !isSentence(part.short)) part.long.forEach(push)
    else push(part)
  })

  return out
}

/**
 * Whether a short form reads as a sentence: four words or more, ending in a full stop or an
 * exclamation mark. "Why." and "Why does it fail?" are labels.
 */
function isSentence(short: string): boolean {
  const text = short.trim()

  return /[.!]["')\]*_]*$/.test(text) && text.split(/\s+/).length >= 4
}

function assignKeys(segments: Segment[], parent: string | undefined): void {
  let n = 0
  for (const segment of segments) {
    if (typeof segment === 'string') continue
    segment.key = parent === undefined ? `${n}` : `${parent}${KEY_SEPARATOR}${n}`
    n += 1
    assignKeys(segment.long ?? [], segment.key)
  }
}

/** Where a fenced code block opening at `start` ends (past its closing line), or undefined when no fence opens there. */
function fenceEnd(text: string, start: number): number | undefined {
  const lineEnd = (from: number) => {
    const end = text.indexOf('\n', from)
    return end === -1 ? text.length : end
  }
  const opening = /^[ \t]*(`{3,}|~{3,})/.exec(text.slice(start, lineEnd(start)))?.[1]
  if (opening === undefined) return undefined

  for (let at = lineEnd(start) + 1; at < text.length; at = lineEnd(at) + 1) {
    const line = text.slice(at, lineEnd(at)).trim()
    if (line.length >= opening.length && [...line].every(c => c === opening[0])) return Math.min(lineEnd(at) + 1, text.length)
  }

  return text.length
}

/** Every stretch, outermost first, in the order the reply writes them. */
export function stretches(segments: Segment[]): Stretch[] {
  return segments.flatMap(segment => (typeof segment === 'string' ? [] : [segment, ...stretches(segment.long ?? [])]))
}

/** What follows the short form of a closed stretch that holds another, so the reader sees that a click goes deeper. */
export const NESTED_MARK = '»'

/** Whether a stretch's long form holds a stretch of its own that is drawn as a link, so a click on it goes deeper. */
export function hasNested(stretch: Stretch): boolean {
  return stretch.long !== undefined && stretches(stretch.long).some(isLinkable)
}

/** Whether `text` holds markup the parser would draw as a stretch: template syntax and code are left as text, so they do not count. */
export function hasMarkup(text: string): boolean {
  const plain = normalize(text)
  return plain.includes('{{') && writeOpen(parse(plain)) !== plain
}

// The keys of a tool call's event that are the engine's, not the tool's arguments.
const RESERVED = new Set(['tool', 'tool_use_id', 'consent'])

/**
 * The dotted path of the first string in a tool call's arguments that holds stretch markup, walking
 * nested objects and arrays, or undefined when none does.
 */
export function markupIn(input: unknown, path = ''): string | undefined {
  if (typeof input === 'string') return hasMarkup(input) ? path : undefined
  if (Array.isArray(input)) {
    for (const [i, item] of input.entries()) {
      const found = markupIn(item, `${path}[${i}]`)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (typeof input !== 'object' || input === null) return undefined
  for (const [key, value] of Object.entries(input)) {
    if (path === '' && RESERVED.has(key)) continue
    const found = markupIn(value, path === '' ? key : `${path}.${key}`)
    if (found !== undefined) return found
  }
  return undefined
}

/** A reply with every stretch drawn as its long form. */
export function writeOpen(parts: Segment[]): string {
  return parts.map(part => (typeof part === 'string' ? part : part.long === undefined ? part.short : writeOpen(part.long))).join('')
}

/** A run of the reply between blank lines, and whether it holds a stretch. */
export type Paragraph = { text: string; hasStretch: boolean }

/**
 * The reply cut at the blank lines that stand outside every stretch and code fence, so a paragraph
 * holding a stretch can be drawn apart from the rest. Neighbouring paragraphs without one are kept
 * together.
 */
export function paragraphsOf(input: string): Paragraph[] {
  const text = normalize(input)
  const { spans } = parseFull(text)
  const isInsideStretch = (at: number) => spans.some(([start, end]) => at > start && at < end)
  const pieces: string[] = []
  let current: string[] = []
  let fence: string | undefined
  let offset = 0
  for (const line of text.split('\n')) {
    const lineStart = offset
    offset += line.length + 1
    const marker = /^[ \t]*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence !== undefined) {
      if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      current.push(line)
      continue
    }
    if (marker !== undefined) {
      fence = marker
      current.push(line)
      continue
    }
    if (line.trim() === '' && !isInsideStretch(lineStart)) {
      if (current.length > 0) pieces.push(current.join('\n'))
      current = []
      continue
    }
    current.push(line)
  }
  if (current.length > 0) pieces.push(current.join('\n'))

  const paragraphs: Paragraph[] = []
  for (const piece of pieces) {
    const hasStretch = stretches(parse(piece)).length > 0
    const last = paragraphs.at(-1)
    if (!hasStretch && last !== undefined && !last.hasStretch) last.text += `\n\n${piece}`
    else paragraphs.push({ text: piece, hasStretch })
  }

  return paragraphs
}
