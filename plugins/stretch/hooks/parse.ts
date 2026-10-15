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
// short form leaves the long form as plain text.

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
  return parseFull(text).root
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
