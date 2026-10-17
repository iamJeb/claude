import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { hasMarkup, markupIn } from '../hooks/parse'

const STRETCH = 'The build fails {{on a stale cache|because the cache key hashes only the manifest}} and the fix is small.'
const PLAIN = 'The build fails because the cache key hashes only the manifest, and the fix is small.'

// The engine beneath the plugin: every call that reaches it ran.
const engine = (on: On) => {
  const ran: unknown[] = []
  on('tool.call', ($, e) => {
    ran.push(e)
    return { result: 'ran', text: 'ran' } as never
  })
  return ran
}
const stretchCommand = ($: Engine, args: string) =>
  $.command.run({ command: 'stretch', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })

describe('markup is found wherever it sits in a tool input', () => {
  test('a stretch in text is markup, template syntax and code are not', () => {
    expect(hasMarkup(STRETCH)).toBe(true)
    expect(hasMarkup(PLAIN)).toBe(false)
    expect(hasMarkup('render {{name|upper}} here')).toBe(false)
    expect(hasMarkup('```\n{{a phrase|its long form}}\n```')).toBe(false)
    expect(hasMarkup('see `{{a phrase|its long form}}` in code')).toBe(false)
    expect(hasMarkup('line one\r\n{{a phrase|its long form}}\r\n')).toBe(true)
  })

  test('the path names the first string that holds it, through objects and arrays', () => {
    expect(markupIn({ tool: 'Write', tool_use_id: 'x', file_path: 'a.md', content: STRETCH })).toBe('content')
    expect(markupIn({ tool: 'Bash', command: `echo "${STRETCH}"` })).toBe('command')
    expect(markupIn({ tool: 'mcp__ado__comment', body: { text: PLAIN, notes: [PLAIN, STRETCH] } })).toBe('body.notes[1]')
    expect(markupIn({ tool: 'Read', file_path: 'a.md' })).toBeUndefined()
    expect(markupIn({ tool: 'Write', file_path: 'a.md', content: PLAIN, consent: STRETCH })).toBeUndefined()
  })
})

describe('a tool call carrying markup is refused', () => {
  test('a file write, a command, a message to another agent and an MCP call are all refused', async ($, on) => {
    const ran = engine(on)
    const calls = [
      { tool: 'Write', file_path: 'notes.md', content: STRETCH },
      { tool: 'Edit', file_path: 'notes.md', old_string: 'a', new_string: STRETCH },
      { tool: 'Bash', command: `git commit -m "${STRETCH}"` },
      { tool: 'Agent', description: 'build', prompt: `Do this: ${STRETCH}` },
      { tool: 'SendMessage', to: 'desk', message: STRETCH },
      { tool: 'mcp__github__add_issue_comment', owner: 'o', repo: 'r', body: STRETCH },
    ]
    for (const call of calls) {
      const answer = await $.tool.call(call as never)
      expect(answer.deny).toMatch(/carries \{\{short\|long\}\} markup/)
      expect(answer.deny).toContain(call.tool)
    }
    expect(ran).toHaveLength(0)
  })

  test('the refusal names the argument so the model knows what to rewrite', async ($, on) => {
    engine(on)
    const answer = await $.tool.call({ tool: 'Write', file_path: 'notes.md', content: STRETCH } as never)
    expect(answer.deny).toContain('"content"')
  })

  test('plain input, template syntax and markup inside a code fence pass through', async ($, on) => {
    const ran = engine(on)
    const calls = [
      { tool: 'Write', file_path: 'notes.md', content: PLAIN },
      { tool: 'Write', file_path: 'tpl.html', content: 'Hello {{name|upper}}' },
      { tool: 'Write', file_path: 'README.md', content: 'Write `{{short|long}}` to mark a phrase.' },
      { tool: 'Bash', command: 'echo done' },
      { tool: 'Read', file_path: 'notes.md' },
    ]
    for (const call of calls) {
      const answer = await $.tool.call(call as never)
      expect(answer.deny).toBeUndefined()
    }
    expect(ran).toHaveLength(calls.length)
  })

  test('with stretch off the guard is lifted, so a file that must hold the markup can be written', async ($, on) => {
    mock.store(on)
    const ran = engine(on)
    await stretchCommand($, 'off')
    const answer = await $.tool.call({ tool: 'Write', file_path: 'tests/ui.test.tsx', content: STRETCH } as never)
    expect(answer.deny).toBeUndefined()
    expect(ran).toHaveLength(1)
    await stretchCommand($, 'on')
    const again = await $.tool.call({ tool: 'Write', file_path: 'tests/ui.test.tsx', content: STRETCH } as never)
    expect(again.deny).toMatch(/markup/)
  })
})
