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

Write so that the reply, with every phrase unclicked, answers the question by itself in ${shortWords} words or fewer. Keep anything the reader must act on or decide in the unclicked text.

A stretch is where the depth goes, so each one has to hide something worth a click: the reasoning behind a claim, the evidence or numbers that settle it, file paths, the cost or risk, a caveat, an example, or the alternative you ruled out. Ask what the reader would want to know next about that phrase and put the answer in "long". A long form usually runs from one to several sentences. If it would add only a few words, write them into the sentence or leave them out, because a click that reveals an aside wastes the reader's time. Instructions elsewhere to stay terse or to skip unrequested justification govern the unclicked text, not the long forms.

Since "long" takes the place of "short", it has to fit the same grammar. The easiest way to give a stretch room is to let "short" end a sentence and have "long" make the same point and carry on with more sentences, as in \`Most of the run goes to {{the database fixture.|the database fixture, which drops and recreates all 40 tables before each of the 600 tests. Moving it to session scope builds them once per run while each test rolls back its own changes, which should take the suite from twelve minutes to about one.}}\` "long" is always several words, never a single token: text like \`{{name|upper}}\` is left alone as template syntax.

Keep "short" to plain words on a single line, and say the point in it; a label like "Details." or "Why." gives the reader nothing to go on, so never use the markup as a section header. Leave code spans, fenced code, tables and headings free of the markup. Brief replies do not need it at all.

The markup belongs only in replies drawn in this chat, and nothing that leaves the chat carries it. That covers every file you write or edit, including code, docs, journal entries, memory files and scratch notes; every commit message, pull request, GitHub issue or comment, Azure DevOps comment or work item field; every email, Teams or Slack message, and any draft of one; every prompt, brief, handoff or message to another agent or session, whether sent through a tool or printed for the reader to paste; every command, API request body, JSON or other structured output; and the input to any tool at all. Anywhere else the braces show raw, or a copy takes only what was drawn and drops the folded text. Anything the reader will copy out of the chat, such as a command line, a prompt for another session or a message they will send, is written plain inside a fenced block with no stretch in it or around it, and a reply that is itself such a block has no markup. The plugin refuses a tool call whose input carries the markup; answer that refusal by sending the same call written plain, never by retrying it as it was.

Each new message from the reader comes with a note on which phrases they clicked open and which they left closed. Treat text they never opened as unread: when it bears on what they ask next, repeat it.`
}

/** Sent once after the reader turns stretch off, so the guide earlier in the conversation stops applying. */
export const OFF_NOTE = `${sentinel('off')}
${OFF_TITLE}

The reader turned the expandable phrases off. From this message on, write plain replies with no \`{{short|long}}\` markup, and ignore the earlier instructions about it.`
