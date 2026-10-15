import { describe, expect, test } from 'claude-code/testing'

import { contextLine } from '../hooks/register'
import { paragraphsOf, parse, stretches, writeOpen } from '../hooks/parse'

describe('parser', () => {
  test('nested stretches are keyed by position, so no short form can collide', async () => {
    const found = stretches(parse('It fails {{on a stale cache|because the key hashes {{one file|only `package.json`}}}}.'))
    expect(found.map(s => s.key)).toEqual(['0', '0 › 0'])
    expect(found.every(s => s.isClosed)).toBe(true)
    expect(writeOpen(parse('It fails {{on a stale cache|because the key hashes {{one file|only `package.json`}}}}.'))).toBe(
      'It fails because the key hashes only `package.json`.',
    )
    expect(stretches(parse('{{a|one x}} {{a|two x}} {{a~2|three x}}')).map(s => s.key)).toEqual(['0', '1', '2'])
  })

  test('only the first | splits; a | inside the long form is text', async () => {
    const [, stretch] = parse('Pick {{one|either a|b or c}} now')
    expect(typeof stretch !== 'string' && stretch?.short).toBe('one')
    expect(writeOpen(parse('Pick {{one|either a|b or c}} now'))).toBe('Pick either a|b or c now')
  })

  test('stray braces stay text and never open a stretch', async () => {
    expect(stretches(parse('a }} b'))).toEqual([])
    expect(writeOpen(parse('a }} b'))).toBe('a }} b')
    expect(stretches(parse('set { x } and {y}'))).toEqual([])
    expect(writeOpen(parse('set { x } and {y}'))).toBe('set { x } and {y}')
    // Braces closed with no bar, and a {{ that never closes, stay literal with nothing dropped.
    expect(parse('Lead {{plain}} end')).toEqual(['Lead {{plain}} end'])
    expect(parse('Lead {{partial|long so far')).toEqual(['Lead {{partial|long so far'])
    expect(writeOpen(parse('A {{x|the y}} then {{ open'))).toBe('A the y then {{ open')
  })

  test('code spans and fenced blocks are left alone', async () => {
    expect(stretches(parse('Use `{{a|b}}` and ``{{c|d}}``.'))).toEqual([])
    expect(writeOpen(parse('Use `{{a|b}}` here.'))).toBe('Use `{{a|b}}` here.')
    const fenced = ['```yaml', 'key: {{hash|x}}', '```', 'After {{s|the long form}}.'].join('\n')
    expect(stretches(parse(fenced)).map(s => s.key)).toEqual(['0'])
    expect(writeOpen(parse(fenced))).toContain('key: {{hash|x}}')
  })

  test('paragraphs split at blank lines outside stretches and fences', async () => {
    const text = ['Plain one.', '', 'With {{a|a long', '', 'form}}.', '', '```', '', '```'].join('\n')
    expect(paragraphsOf(text).map(p => p.hasStretch)).toEqual([false, true, false])
  })
})

describe('context line', () => {
  test('names what was opened and what was not', async () => {
    expect(contextLine(['cache'], ['cache', 'the fix'])).toBe('Stretch: in your last reply the reader opened "cache". They did not open "the fix".')
    expect(contextLine(['cache'], ['cache'])).toBe('Stretch: in your last reply the reader opened "cache".')
  })

  test('with nothing opened it lists every stretch as unopened', async () => {
    expect(contextLine([], ['cache', 'the fix'])).toMatch(/^Stretch: in your last reply the reader opened none of "cache", "the fix"\./)
  })

  test('a reply without stretches adds no line', async () => {
    expect(contextLine([], [])).toBeUndefined()
  })
})
