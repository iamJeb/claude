// What a reader faces in one reply, in words, using the plugin's own parser:
//   skim  every stretch closed: the reply as it first appears
//   full  every stretch open: everything the model wrote
//   read  the stretches the reader actually opened, and nothing else
import { isLinkable, isOpenable, parse } from '../hooks/parse.ts'
import type { Segment, Stretch } from '../hooks/parse.ts'

/**
 * How the screen draws a stretch: as plain text when there is nothing to open, already open when
 * its short form spans lines, otherwise as a link. The parser has already written a label stretch
 * open, so one never reaches this.
 */
export function drawnAs(stretch: Stretch): 'text' | 'open' | 'link' {
  if (!isOpenable(stretch)) return 'text'
  return isLinkable(stretch) ? 'link' : 'open'
}

/** The reply's text with the stretches whose short form is in `opened` open (all of them for 'all'). */
export function render(reply: string, opened: ReadonlySet<string> | 'all'): string {
  return draw(parse(reply), opened)
}

/**
 * `parts` as the screen draws them, with the stretches whose short form is in `opened` open. A
 * short form over several lines is drawn open whatever is opened, or as written when its long form
 * is empty. `mark`, when given, wraps the text drawn in each link's place, open or closed.
 */
export function draw(parts: Segment[], opened: ReadonlySet<string> | 'all', mark = (_: Stretch, drawn: string) => drawn): string {
  return parts
    .map(part => {
      if (typeof part === 'string') return part
      const long = part.long ?? []
      switch (drawnAs(part)) {
        case 'text':
          return part.short
        case 'open':
          return long.length === 0 ? part.short : draw(long, opened, mark)
        case 'link': {
          return mark(part, opened === 'all' || opened.has(part.short.trim()) ? draw(long, opened, mark) : part.short)
        }
      }
    })
    .join('')
}

/** A reply's skim with each link in view numbered, and their long forms, opened, in that order: what the label judge reads. */
export function marked(text: string): { skim: string; longs: string[] } {
  const longs: string[] = []
  const skim = draw(parse(text), new Set(), (link, shown) => {
    longs.push(draw(link.long ?? [], 'all'))
    return `⟦${longs.length}⟧${shown}⟦/${longs.length}⟧`
  })
  return { skim, longs }
}

/** A rewrite keeping less of the original's content words than this is broken (a refusal, a summary), not shorter, and is not judged. */
export const VALID_RECALL = 0.9

/** How many of the original's content words (four letters or more) the full rewrite still has. */
export function recall(original: string, full: string): number {
  const bag = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_'-]{4,}/gu) ?? [])
  const before = bag(original), after = bag(full)
  return before.size === 0 ? 1 : [...before].filter(w => after.has(w)).length / before.size
}

/** Words a person reads: whitespace-separated tokens holding a letter or a digit. */
export function words(text: string): number {
  return text.split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length
}

export type Measure = { skim: number; full: number; read?: number }

export function measure(reply: string, opened?: ReadonlySet<string>): Measure {
  const skim = words(render(reply, new Set()))
  const full = words(render(reply, 'all'))
  return opened === undefined ? { skim, full } : { skim, full, read: words(render(reply, opened)) }
}

/**
 * The reader's opened stretches from the note the plugin adds to their next prompt, which names
 * each stretch by its short form: `Stretch: in your last reply the reader opened "a", "b". They did
 * not open "c".`, or `... the reader opened none of "c".` when nothing was opened.
 */
export function openedFrom(note: string): Set<string> {
  if (/reader opened none of/.test(note)) return new Set()
  const part = /reader opened (.*?)(?:\. They did not open|\.$)/s.exec(note)?.[1] ?? ''
  return new Set([...part.matchAll(/"([^"]*)"/g)].map(m => (m[1] ?? '').trim()))
}
