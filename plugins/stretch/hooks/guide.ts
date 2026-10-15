// What the plugin sends the model about the markup, and the settings that shape it.

export const GUIDE_TITLE = '# Expandable phrases in chat replies'
const OFF_TITLE = '# Expandable phrases are off'

// The first line of the guide and of the off note, written by the plugin alone, by which a copy
// already in the conversation is found. A title quoted in a prompt or in a compaction's summary
// is not a copy.
const sentinel = (kind: 'guide' | 'off', words?: number) => `<!-- stretch-${kind} v2${words === undefined ? '' : ` n=${words}`} -->`
// Found at the start of a line, plain or as the engine labels a hook's context.
const SENTINEL = /(?:^|\n)(?:prompt\.submit hook additional context: )?<!-- stretch-(guide|off) v2(?: n=(\d+))? -->/g

/** What the plugin last sent about the markup, in `text`: the guide and its word count, or the off note. */
export type Sent = { kind: 'guide'; words: number } | { kind: 'off' }

/** The last guide or off note the plugin wrote in `text`, found by its sentinel; undefined for none. */
export function lastSentIn(text: string): Sent | undefined {
  let last: Sent | undefined
  for (const match of text.matchAll(SENTINEL)) {
    last = match[1] === 'off' ? { kind: 'off' } : { kind: 'guide', words: Number(match[2]) }
  }

  return last
}

export const DEFAULT_SHORT_WORDS = 150
const MIN_SHORT_WORDS = 10
const MAX_SHORT_WORDS = 2000

/** The plugin's /config settings, each at its default where missing or invalid. */
export type Settings = { shortWords: number; foldTools: boolean }

export function settingsOf(options: Readonly<Record<string, unknown>> | undefined): Settings {
  const words = options?.shortWords
  const n = typeof words === 'number' ? words : typeof words === 'string' && /^\s*\d+\s*$/.test(words) ? Number(words) : NaN
  const shortWords = Number.isFinite(n) && n >= MIN_SHORT_WORDS && n <= MAX_SHORT_WORDS ? Math.round(n) : DEFAULT_SHORT_WORDS
  const foldTools = typeof options?.foldTools === 'boolean' ? options.foldTools : true

  return { shortWords, foldTools }
}

/** The guide, sent with the first prompt of a conversation and again after a compaction or a /clear. */
export function guide(shortWords: number): string {
  return `${sentinel('guide', shortWords)}
${GUIDE_TITLE}

You can mark a phrase as \`{{short|long}}\`. On screen the reader sees only "short", underlined. If they click it, "long" replaces it in the sentence, and a close marker after it puts "short" back. Markup can sit inside a long form to go one level deeper.

Write so that the reply, with every phrase unclicked, answers the question by itself in ${shortWords} words or fewer. Keep anything the reader must act on or decide in the unclicked text. Since "long" takes the place of "short" mid-sentence, it has to fit the same grammar. "long" is always a phrase of several words, never a single token: text like \`{{name|upper}}\` is left alone as template syntax.

Keep "short" to plain words on a single line, and say the point in it; a label like "Details." or "Why." gives the reader nothing to go on, so never use the markup as a section header. Leave code spans, fenced code, tables and headings free of the markup. Brief replies do not need it at all.

The markup belongs only in replies shown in this chat. Files you write, commit messages, Azure DevOps comments, emails and the input to any tool get none, since there it would appear as raw braces.

Each new message from the reader comes with a note on which phrases they clicked open and which they left closed. Treat text they never opened as unread: when it bears on what they ask next, repeat it.`
}

/** Sent once after the reader turns stretch off, so the guide earlier in the conversation stops applying. */
export const OFF_NOTE = `${sentinel('off')}
${OFF_TITLE}

The reader turned the expandable phrases off. From this message on, write plain replies with no \`{{short|long}}\` markup, and ignore the earlier instructions about it.`
