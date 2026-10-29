// Reads Claude Code session transcripts (the JSONL files under ~/.claude/projects, as written by
// Claude Code 2.1.312) into turns: the person's prompt, the reply they read, whether the guide was
// in force when it was written, and the reading note the plugin attached to their next prompt.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { lastSentIn } from '../hooks/guide.ts'
import type { Sent } from '../hooks/guide.ts'
import { openedFrom } from './measure.ts'

export type Turn = {
  session: string
  index: number
  prompt: string
  /** The text after the turn's last tool call: what the person reads as the answer. */
  reply: string
  /** Whether the plugin's guide was the last thing it had sent about the markup when the reply was written. */
  isGuided: boolean
  /** The short forms the reader opened, from the note on the next prompt; undefined when there was none. */
  opened?: Set<string>
}

type Block = { type?: string; text?: string }
type Row = {
  type?: string
  isMeta?: boolean
  /** Set on newer transcripts: `human` for a prompt the person typed. */
  origin?: { kind?: string }
  message?: { role?: string; content?: string | Block[] }
  attachment?: { type?: string; content?: unknown }
}

const textOf = (content: string | Block[] | undefined) =>
  typeof content === 'string' ? content : (content ?? []).filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')

/**
 * A prompt the person typed. Newer transcripts say so in `origin`; older ones are judged by
 * content: not a tool result, a reminder, a command's echo, a skill's text or a notification.
 */
function isPrompt(row: Row): boolean {
  if (row.type !== 'user' || row.isMeta || row.message?.role !== 'user') return false
  if (row.origin !== undefined) return row.origin.kind === 'human'
  const content = row.message.content
  if (Array.isArray(content) && content.some(b => b.type === 'tool_result')) return false
  const text = textOf(content).trim()
  return text !== '' && !/^(<|Base directory for this skill|\[Image|Caveat:|This session is being continued)/.test(text)
}

/** The strings a hook attached to a prompt, as the model read them; nothing for any other row. */
function attachedText(row: Row): string[] {
  if (row.type !== 'attachment' || row.attachment?.type !== 'hook_additional_context') return []
  const content = row.attachment.content
  if (typeof content === 'string') return [content]
  return Array.isArray(content) ? content.filter((item): item is string => typeof item === 'string') : []
}

/** The path's name without its folder or `.jsonl`, which is the session id. */
export const sessionOf = (path: string) => basename(path).replace(/\.jsonl$/, '')

export function turnsOf(path: string): Turn[] {
  const rows: Row[] = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Row)
  const session = sessionOf(path)
  const turns: Turn[] = []
  let sent: Sent | undefined
  let current: { prompt: string; isGuided: boolean; texts: string[] } | null = null
  const close = () => {
    if (current && current.texts.length > 0) {
      turns.push({ session, index: turns.length, prompt: current.prompt, reply: current.texts.join('\n\n').trim(), isGuided: current.isGuided })
    }
  }
  for (const row of rows) {
    if (isPrompt(row)) {
      close()
      current = { prompt: textOf(row.message?.content).trim(), isGuided: sent?.kind === 'guide', texts: [] }
      continue
    }
    const attached = attachedText(row)
    if (attached.length > 0) {
      // The guide and the off note are found by their sentinels, of any version, so transcripts
      // written under an earlier guide still count; the reading note by its first words.
      const latest = lastSentIn(attached.join('\n'), true)
      if (latest !== undefined) {
        sent = latest
        if (current) current.isGuided = sent.kind === 'guide'
      }
      const note = attached.find(text => text.startsWith('Stretch: in your last reply'))
      const last = turns.at(-1)
      if (note !== undefined && last !== undefined) last.opened = openedFrom(note)
      continue
    }
    if (!current || row.type !== 'assistant') continue
    const content = row.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      // A tool call starts the reply over: only the text after the last one is the answer.
      if (block.type === 'tool_use') current.texts = []
      else if (block.type === 'text' && (block.text ?? '').trim() !== '') current.texts.push(block.text ?? '')
    }
  }
  close()
  return turns
}

/** `path` with a leading `~` as the home folder, made absolute. */
export function expand(path: string): string {
  return resolve(path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path)
}

/** The transcript files `paths` name: each one given, and every `.jsonl` in each folder given, in name order. */
export function transcriptsIn(paths: readonly string[]): string[] {
  return paths.flatMap(given => {
    const path = expand(given)
    if (!statSync(path).isDirectory()) return [path]
    return readdirSync(path).filter(name => name.endsWith('.jsonl')).sort().map(name => join(path, name))
  })
}
