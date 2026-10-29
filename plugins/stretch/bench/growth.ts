// Where a long form's added words land around its short form. The plugin's hooks/grow.ts animates
// a growth with the same anchoring, keeping the short form's words still while the new ones open
// around them; the bench only counts the words, so the anchoring is kept here on its own, with no
// import from the hooks that node cannot load.
import type { Segment, Stretch } from '../hooks/parse.ts'

type Token = { kind: 'word' | 'space'; text: string } | { kind: 'nested'; stretch: Stretch }

/** Where a run of new words sits relative to the anchors around it. */
type Side = 'before' | 'between' | 'after'

/**
 * Where a long form's added words and nested stretches land around the short form's words: before
 * the first, between two, or after the last (all of them, when the short form has none in it). And
 * how many of the short form's words the long form is missing, in order.
 */
export function growthOf(short: string, long: Segment[]): Record<Side, number> & { missing: number } {
  const tokens = tokenize(long)
  const { anchors, missing } = anchorsOf(short, tokens)
  const counts = { before: 0, between: 0, after: 0, missing }
  let run = 0
  let hasAnchorBefore = false
  tokens.forEach((token, i) => {
    if (anchors.has(i) && token.kind !== 'space') {
      counts[hasAnchorBefore ? 'between' : 'before'] += run
      run = 0
      hasAnchorBefore = true
    } else if (token.kind !== 'space') run += 1
  })
  counts.after += run

  return counts
}

function tokenize(long: Segment[]): Token[] {
  return long.flatMap((part): Token[] =>
    typeof part === 'string'
      ? part
          .split(/(\s+)/)
          .filter(text => text !== '')
          .map(text => ({ kind: /^\s+$/.test(text) ? 'space' : 'word', text }))
      : [{ kind: 'nested', stretch: part }],
  )
}

/**
 * The token indexes of the long form that carry the short form's words, as many as can be kept in
 * order (a longest common subsequence), and how many short form words found no place. A nested
 * stretch shows its own short form, so its words count where it stands.
 */
function anchorsOf(short: string, tokens: Token[]): { anchors: Set<number>; missing: number } {
  const want = short.split(/\s+/).map(bare).filter(word => word !== '')
  const have: { token: number; word: string }[] = []
  tokens.forEach((token, i) => {
    const words = token.kind === 'word' ? [token.text] : token.kind === 'nested' ? token.stretch.short.split(/\s+/) : []
    for (const word of words.map(bare).filter(w => w !== '')) have.push({ token: i, word })
  })

  // lengths[i][j]: the longest common run of want[i..] and have[j..].
  const lengths = Array.from({ length: want.length + 1 }, () => new Array<number>(have.length + 1).fill(0))
  for (let i = want.length - 1; i >= 0; i--) {
    for (let j = have.length - 1; j >= 0; j--) {
      const row = lengths[i] ?? [], below = lengths[i + 1] ?? []
      row[j] = want[i] === have[j]?.word ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  const anchors = new Set<number>()
  let kept = 0
  for (let i = 0, j = 0; i < want.length && j < have.length; ) {
    if (want[i] === have[j]?.word) {
      anchors.add(have[j]?.token ?? -1)
      kept += 1
      i++
      j++
    } else if ((lengths[i + 1]?.[j] ?? 0) >= (lengths[i]?.[j + 1] ?? 0)) i++
    else j++
  }
  // Punctuation standing on its own right after an anchor belongs to that anchor.
  let last = -1
  tokens.forEach((token, i) => {
    if (token.kind === 'space') return
    if (token.kind === 'word' && bare(token.text) === '' && anchors.has(last)) anchors.add(i)
    last = i
  })

  return { anchors, missing: want.length - kept }
}

/** A word without its surrounding punctuation or markdown marks, lowercased, so a word with a full stop meets the same word in bold. */
function bare(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase()
}
