// The guide variants the guide bench compares, by name: the plugin's own guide (g0) and versions of
// it with sentences added or replaced that isolate different writing instructions. A guide tried
// once stays here under its name, so a later run can compare against it. The plugin's guide is
// prose, so a variant anchors on a sentence of it rather than on a bullet.
import { DEFAULT_SHORT_WORDS, guide } from '../hooks/guide.ts'

/** The sentences of the plugin's guide that variants anchor on, as the guide writes them. */
const ACT = 'Keep anything the reader must act on or decide in the unclicked text.'
const LIST = 'Stretch list items, not whole lists.'
const GRAMMAR = 'Since "long" takes the place of "short", it has to fit the same grammar.'
const PLAIN = 'Keep "short" to plain words on a single line, and say the point in it; a label like "Details." or "Why." gives the reader nothing to go on, so never use the markup as a section header.'
const length = (shortWords: number) => `Write so that the reply, with every phrase unclicked, answers the question by itself in ${shortWords} words or fewer.`

const GROW = `Grow inside the sentence where you can: the best stretch adds a qualifier before a word, a clause between two words and a detail after them, so the short form reads as the same sentence with less in it, as in "{{The fix keys the cache on the lockfile.|The fix, in \`ci/cache.ts\`, keys the CI cache on the lockfile as well as \`package.json\`, so a dependency bump no longer reuses a stale cache.}}". A stretch that only adds text after its short form reads like a heading and its body, and the reader has to open it to learn anything.`
const FILLER = 'Keep the unclicked text to what the reader needs: the answer, what they must decide or do, and the results. Hedges, reasons, background, caveats, restatements and courtesy go inside long forms, where a reader who wants them finds them.'
const TRUE = 'Every short form stays true without a click. A condition, doubt, limit or warning that changes what it claims, or what the reader should do next, stays in the short form itself: "the import probably finishes tonight" never shortens to "the import finishes tonight", nor "safe to rerun once the lock is released" to "safe to rerun".'
const CLAIM = 'To find a short form, write the full sentence, then delete words until what is left is a grammatical claim with the same subject and outcome. A short form makes that claim ("The retry duplicates writes."); it never only announces its topic ("Retry details." or "There is a retry issue.").'
const DRAFT = 'Draft the reply in your thinking first, as plain sentences with all their detail, and choose there the words each detail grows around. Then write the reply from the draft, opening each stretch before those words: a stretch opens before its short form, so a sentence already written can no longer become one.'
const SECTIONS_FINDING = 'A stretch that holds several sections or a list gets a short form that states the main finding they support, with its source and any doubt.'

/** Whether `text` holds `sentence` as a sentence of its own, with a space before it. */
const holds = (text: string, sentence: string) => text.includes(` ${sentence}`)

/**
 * `base` with `sentence` inserted right after the first sentence `anchor`, or `base` itself when it
 * already holds `sentence`: a sentence the plugin's guide took up keeps every variant that adds it
 * the same.
 */
function withSentence(base: string, anchor: string, sentence: string): string {
  if (holds(base, sentence)) return base
  const at = base.indexOf(anchor)
  if (at === -1) throw new Error(`no sentence reads ${anchor}`)
  const end = at + anchor.length
  return `${base.slice(0, end)} ${sentence}${base.slice(end)}`
}

/** `base` with the first sentence `anchor` replaced by `sentence`. */
function withReplaced(base: string, anchor: string, sentence: string): string {
  if (!base.includes(anchor)) throw new Error(`no sentence reads ${anchor}`)
  return base.replace(anchor, sentence)
}

/** Each additive variant as the sentences it adds and the sentence each goes after, in reading order. */
const RECIPES: Readonly<Record<string, readonly (readonly [anchor: string, sentence: string])[]>> = {
  g0: [],
  /** Grow inside the sentence. */
  grow: [[GRAMMAR, GROW]],
  /** Keep the unclicked text to what the reader needs. */
  filler: [[ACT, FILLER]],
  /** grow and filler together. */
  'grow-filler': [[ACT, FILLER], [GRAMMAR, GROW]],
  /** Every short form stays true without a click. */
  true: [[ACT, TRUE]],
  /** A short form makes a claim rather than naming a topic. */
  claim: [[GRAMMAR, CLAIM]],
  /** true, and claim. */
  'true-claim': [[ACT, TRUE], [GRAMMAR, CLAIM]],
  /** The list rule on its own is the plugin's guide; this variant has it say what a short form does. */
  'answer-explain': [[LIST, 'Short forms answer; long forms explain.']],
  /** Explicitly exclude links that give no information. */
  'no-labels': [[LIST, 'A short form states useful information, never a heading, topic label, teaser or punctuation alone.']],
  /** Show the difference between naming a subject and stating its result. */
  example: [[LIST, 'A short form says what is true: "{{The cache survives restarts.|The local cache survives process restarts because SQLite persists it on disk.}}". "Storage details." only names the subject and is not a useful short form.']],
  /** Put headings outside stretches and stretch the statements they introduce. */
  'headings-outside': [[LIST, 'Keep topic headings as ordinary text, and make the statement beneath each heading a stretch.']],
  /** Draft the reply in thinking first, and choose each short form's words there. */
  'draft-in-thinking': [[GRAMMAR, DRAFT]],
  /** A stretch that hides several sections or a list gets a one-line gist for its short form. */
  'sections-gist': [[PLAIN, 'A stretch that hides several sections or a list needs a short form of the same kind: a one-line gist of what they say, never a line that only names them.']],
  /** Keep sections in view, as list items are, so no one stretch hides several. */
  'sections-within': [[LIST, 'Stretch within each section, never around several sections at once.']],
  /** A stretch over several sections states their finding, and its long form opens with that same sentence. */
  'sections-open': [[GRAMMAR, `${SECTIONS_FINDING} Begin its long form with that same sentence unchanged, then give the sections.`]],
  /** sections-open, but the finding's words run through the sections in order, with words added before, between and after them. */
  'sections-woven': [[GRAMMAR, `${SECTIONS_FINDING} Its words then run through the sections in order, with the rest added before, between and after them.`]],
}

/** The plugin's guide with its explanatory prose cut, keeping its rules and example. */
const shortened = (shortWords: number) => `# Expandable phrases in chat replies

You can mark a phrase as \`{{short|long}}\`: the reader sees "short", and a click replaces it with "long" in place. Markup can sit inside a long form to go one level deeper.

Write so that the reply, with every phrase unclicked, answers the question by itself in ${shortWords} words or fewer, and keep what the reader must act on or decide in the unclicked text. Stretch list items, not whole lists.

"long" keeps every word of "short" in order, adding words before, between and after them, and reads correctly in its place. Each stretch hides something worth a click; a long form of only a few words is written into the sentence instead.

Keep "short" to plain words on one line that say the point, never a label. Keep stretches out of code, tables and headings. Brief replies need none.

Example: "{{The build fails on a stale cache.|The CI build fails, about one run in five, on a stale dependency cache keyed only by \`package.json\`.}}"

Nothing that leaves the chat carries the markup: no file, commit, message, command or tool input. Each new message from the reader says which phrases they opened; treat the rest as unread and repeat it when it matters.`

/** The same guide, saying what the words already seen do while a stretch grows. */
const shortenedGrowth = (shortWords: number) =>
  withReplaced(
    shortened(shortWords),
    '"long" keeps every word of "short" in order, adding words before, between and after them, and reads correctly in its place.',
    '"long" keeps every word of "short" in order, adding words before, between and after them, so the words the reader already saw stay where they are. It reads correctly in its place: a phrase grows into a clause, a sentence into a paragraph, a paragraph into several.',
  )

/** A short guide written from scratch around deriving the short form from the long. */
const compactDerived = (shortWords: number) => `# Expandable phrases in chat replies

Use \`{{short|long}}\` for detail revealed in place. Write long first, then derive short by deleting words. Short states the point in its sentence.

Keep the answer, results, actions, limits and uncertainty visible, in ${shortWords} words or fewer with every phrase unclicked. Keep headings and list structure visible; stretch each list item separately. If the answer needs no explanation, leave it plain. Each expansion adds useful detail.

Short forms are plain inline text on one line. Keep code, tables and headings outside stretch syntax. Expansions may nest. Nothing that leaves the chat carries the markup.

Reading notes identify opened stretches; restate hidden information when needed.`

/** A short guide written from scratch, in plain rules. */
const compact = (shortWords: number) => `# Expandable phrases in chat replies

The screen shows short in \`{{short|long}}\`; a click replaces it with long in place.

Answer in the visible text, in ${shortWords} words or fewer. Keep results, decisions, actions, warnings and uncertainty visible. Stretch list items separately. Keep headings as ordinary text.

A short form states the point in its sentence. The long form keeps its words in order and adds detail. Example: "{{The cache survives restarts.|The local cache survives process restarts because SQLite persists it on disk.}}"

Short forms are plain text on one line. Keep stretch syntax out of code, tables and headings, and out of anything that leaves the chat. Expansions may nest. Already short answers need no stretches.

Reading notes say which stretches were opened. Restate hidden information when a later question needs it.`

/** Every variant, built on the plugin's guide at `shortWords`. */
export function variants(shortWords: number): Readonly<Record<string, string>> {
  const base = guide(shortWords)
  const additions = Object.fromEntries(
    Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.reduce((text, [anchor, sentence]) => withSentence(text, anchor, sentence), base)]),
  )
  return {
    ...additions,
    /** No length for the unclicked text, only that it answers on its own. */
    'no-length-rule': withReplaced(base, length(shortWords), 'Write so that the reply, with every phrase unclicked, answers the question by itself.'),
    /** No word count, as many short sentences or list items as the answer needs. */
    uncapped: withReplaced(base, length(shortWords), 'Write so that the reply, with every phrase unclicked, answers the question by itself, using as many short sentences or list items as it needs.'),
    shortened: shortened(shortWords),
    'shortened-growth': shortenedGrowth(shortWords),
    'compact-derived': compactDerived(shortWords),
    compact: compact(shortWords),
  }
}

export const VARIANTS: Readonly<Record<string, string>> = variants(DEFAULT_SHORT_WORDS)

/** The sentences each variant in RECIPES adds to g0, in reading order, for a test to hold it to them. */
export const ADDED: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(RECIPES).map(([name, recipe]) => [name, recipe.map(([, sentence]) => sentence).filter(sentence => !holds(guide(DEFAULT_SHORT_WORDS), sentence))]),
)
