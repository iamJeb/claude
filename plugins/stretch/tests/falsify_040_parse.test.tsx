import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { DEFAULT_SHORT_WORDS, guide, lastSentIn, OFF_NOTE } from '../hooks/guide'
import { paragraphsOf, parse, stretches, writeOpen } from '../hooks/parse'

// Tries to break the 0.4.0 parser fix (a closing fence line ending in the braces of the stretch
// around it) and the guide change (one new sentence, sentinel v3).
// The braces are built from escapes, so this file's own text carries no markup for the tool guard.

const O = '{{'
const C = '}}'
const F = '```'
const S = (short: string, long: string) => `${O}${short}|${long}${C}`

const keys = (text: string) => stretches(parse(text)).map(s => [s.key, s.isClosed])
/** Stretches found paragraph by paragraph, which must match the whole reply's when the cut agrees with the parser. */
const perParagraph = (text: string) => paragraphsOf(text).reduce((n, p) => n + stretches(parse(p.text)).length, 0)

describe('fence close: a closing fence line outside any stretch', () => {
  test('a fence-and-braces line in a plain paragraph opens a block as markdown does, closes nothing and stays literal', async () => {
    const text = `Before.\n\n${F}${C}\nplain\n\nAfter ${S('a', 'the b')}.`
    expect(keys(text)).toEqual([])
    expect(writeOpen(parse(text))).toBe(text)
    expect(paragraphsOf(text)).toEqual([{ text, hasStretch: false }])
  })

  test('after a stretch has closed, a root block is not closed by a fence-and-braces line', async () => {
    const text = `${S('The first one is here.', 'The first one is here, long.')}\n\n${F}\ncode\n${F}${C}\n\nAfter ${S('a', 'the b')}.`
    expect(keys(text)).toEqual([['0', true]])
    expect(writeOpen(parse(text))).toBe(`The first one is here, long.\n\n${F}\ncode\n${F}${C}\n\nAfter ${S('a', 'the b')}.`)
    expect(perParagraph(text)).toBe(1)
  })
})

describe('fence close: inside a long form', () => {
  test('two and three nested stretches close on one fence line, and the text after is plain', async () => {
    expect(keys(`Lead ${O}a|outer ${O}b|inner\n${F}\nx\n${F}${C}${C}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['0 › 0', true], ['1', true]])
    const three = `Lead ${O}a|outer ${O}b|mid ${O}c|inner\n${F}\nx\n${F}${C}${C}${C}\nafter ${S('d', 'the e')}`
    expect(keys(three)).toEqual([['0', true], ['0 › 0', true], ['0 › 0 › 0', true], ['1', true]])
    expect(writeOpen(parse(three))).toBe(`Lead outer mid inner\n${F}\nx\n${F}\nafter the e`)
  })

  test('a space between the fence and the braces still closes, single and nested', async () => {
    expect(keys(`Lead ${S('a', `the x\n${F}\ncode\n${F} `)}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['1', true]])
    expect(keys(`Lead ${O}a|the ${O}b|the x\n${F}\ncode\n${F} ${C} ${C}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['0 › 0', true], ['1', true]])
  })

  test('a four-backtick block is not closed by three backticks and braces, only by four', async () => {
    const short = `Lead ${O}a|the x\n${'````'}\ncode\n${F}${C}\nafter ${S('d', 'the e')}`
    expect(keys(short)).toEqual([])
    expect(writeOpen(parse(short))).toBe(short)
    expect(keys(`Lead ${O}a|the x\n${'````'}\ncode\n${'````'}${C}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['1', true]])
  })

  test('a ~~~ block ignores a backtick fence with braces and closes on its own marker with braces', async () => {
    const text = `Lead ${O}a|the x\n~~~\ncode\n${F}${C}\n~~~${C}\nafter ${S('d', 'the e')}`
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(writeOpen(parse(text))).toBe(`Lead the x\n~~~\ncode\n${F}${C}\n~~~\nafter the e`)
    expect(perParagraph(text)).toBe(2)
  })

  test('braces on code lines that are not a fence stay code', async () => {
    const text = `Lead ${O}a|the x\n${F}\nconst o = { a: { b: 1 }${C}\n${C}\n  ${C}  \n${F}${C}\nafter ${S('d', 'the e')}`
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(writeOpen(parse(text))).toBe(`Lead the x\n${F}\nconst o = { a: { b: 1 }${C}\n${C}\n  ${C}  \n${F}\nafter the e`)
  })

  test('an opening fence line carrying braces opens a block with them as its info string; the stretch closes later', async () => {
    const text = `Lead ${O}a|the x\n${F}${C}\ncode\n${F}\n${C} after ${S('d', 'the e')}`
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(writeOpen(parse(text))).toBe(`Lead the x\n${F}${C}\ncode\n${F}\n after the e`)
  })

  test('```python inside the block does not close it, and a bare fence line still closes as before', async () => {
    expect(keys(`Lead ${O}a|the x\n${F}\n${F}python\ny\n${F}${C}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['1', true]])
    const bare = `Lead ${O}a|the x\n${F}\ny\n${F}\n${C}\nafter ${S('d', 'the e')}`
    expect(keys(bare)).toEqual([['0', true], ['1', true]])
    expect(writeOpen(parse(bare))).toBe(`Lead the x\n${F}\ny\n${F}\n\nafter the e`)
  })

  test('CRLF line endings close the same way and the paragraph cut agrees', async () => {
    const text = `Lead ${O}a|the x\r\n${F}\r\ny\r\n${F}${C}\r\n\r\nafter ${S('d', 'the e')}`
    expect(keys(text)).toEqual([['0', true], ['1', true]])
    expect(paragraphsOf(text).map(p => p.hasStretch)).toEqual([true, true])
  })

  test('a fence inside a short form is not closed by braces there', async () => {
    const text = `${O}Lead in\n${F}\na\n${F}${C}\n\nAfter ${S('x', 'the y')}.`
    expect(keys(text)).toEqual([])
    expect(writeOpen(parse(text))).toBe(text)
  })
})

describe('defect: fence close with text after the braces', () => {
  // The close needs nothing but braces after the fence. Text after them, such as the rest of an
  // outer long form, leaves the block unclosed, so every stretch to the end of the reply turns
  // literal inside one code block.
  test('closing the inner stretch on the fence line and carrying on in the outer long form', async () => {
    expect(keys(`Lead ${O}a|outer ${O}b|inner\n${F}\nx\n${F}${C} tail${C}\nafter ${S('d', 'the e')}`)).toEqual([['0', true], ['0 › 0', true], ['1', true]])
  })

  test('a single stretch with words after the braces does not take the next stretch with it', async () => {
    const text = `Lead ${O}a|the x\n${F}\ncode\n${F}${C} and more.\n\nNext ${S('d', 'the e')}.`
    expect(stretches(parse(text)).map(s => s.short)).toContain('d')
  })
})

describe('defect: fence close in a stretch the parser then rejects', () => {
  // A long form that reads as template syntax is rejected and read again as text, and on that pass
  // the block is no longer inside a long form, so it runs to the end and swallows what follows.
  test('a long form starting KEY=value and ending in a fence with braces keeps the next stretch', async () => {
    const text = `${O}Set the flag.|FLAG=1 goes in the env file:\n${F}\nFLAG=1\n${F}${C}\n\nAfter ${S('b', 'the c d')}.`
    expect(stretches(parse(text)).map(s => s.short)).toEqual(['b'])
  })
})

describe('defect: more closing braces on the fence line than stretches open', () => {
  // The spare braces stay as text on the closing fence line, so the opened reply's fence carries
  // trailing text and no longer closes its block in markdown.
  test('the opened reply keeps a bare closing fence line', async () => {
    const text = `Lead ${O}a|the x\n${F}\ncode\n${F}${C}${C}${C}\nafter ${S('d', 'the e')}`
    const opened = writeOpen(parse(text)).split('\n')
    expect(opened[3]).toBe(F)
  })
})

describe('defect: paragraph cut against the parser for a fence in a short form', () => {
  // paragraphsOf closes a fence on fence-and-braces anywhere inside a stretch span, short forms
  // included; the parser does so only inside a long form. The fence states then differ and the
  // blank line after the stretch no longer cuts.
  test('the blank line after the stretch cuts, as the parser sees it', async () => {
    const text = `${O}s\n${F}\na\n${F}${C}\n${F}\n|long words here${C}\n\nAfter ${S('x', 'the y')}.`
    expect(stretches(parse(text)).map(s => s.short)).toEqual(['x'])
    expect(paragraphsOf(text).length).toBe(2)
  })
})

const FS = { columns: 100, rows: 40, isFullscreen: true }
const mount = ($: Engine, text: string) =>
  $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId: 'reply-falsify', viewport: FS })
type Mounted = Awaited<ReturnType<typeof mount>>
const engine = (on: On) =>
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
const rowsOf = async (ui: Mounted, key: string): Promise<string> => {
  const tree = await ui.drawn({ in: key })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf).join('\n')
}

describe('fence close while streaming', () => {
  test('one character at a time from the fence line on, with a cut between the backticks and the braces', async ($, on) => {
    engine(on)
    const full = [`${O}Count the rows first.|Count the rows first, with`, '', '```bash', 'git push', `${F}${C}`, '', `After ${S('risks', 'the risks')}.`].join('\n')
    const fenceLine = full.indexOf(`${F}${C}`)
    const ui = await mount($, full.slice(0, fenceLine))
    for (let end = fenceLine + 1; end <= full.length; end++) {
      const text = full.slice(0, end)
      await ui.redraw({ text, isFirstOfReply: true })
      const paragraphs = paragraphsOf(text)
      // Cut between the backticks and the braces: the bare fence closes the block, the stretch is still open.
      if (end === fenceLine + 3) expect([text.endsWith(F), stretches(parse(text)).length]).toEqual([true, 0])
      if (end >= fenceLine + 5) {
        expect(paragraphs[0]?.hasStretch).toBe(true)
        expect(await rowsOf(ui, 'paragraph-0')).toBe('Count the rows first.')
      }
    }
    expect(await rowsOf(ui, 'paragraph-1')).toBe('After risks.')
    await ui.unmount()
  })
})

describe('guide: the list sentence and the v3 sentinel', () => {
  const ACT = 'Keep anything the reader must act on or decide in the unclicked text.'
  const LIST = 'Stretch list items, not whole lists.'

  test('the list sentence appears once, right after the act-on sentence, at any word count', async () => {
    for (const n of [10, DEFAULT_SHORT_WORDS, 2000]) {
      const text = guide(n)
      expect([n, text.split(LIST).length - 1]).toEqual([n, 1])
      expect([n, text.includes(`${ACT} ${LIST}`)]).toEqual([n, true])
    }
  })

  test('the guide and the off note start with v3 sentinels', async () => {
    expect(guide(DEFAULT_SHORT_WORDS).split('\n')[0]).toBe(`<!-- stretch-guide v3 n=${DEFAULT_SHORT_WORDS} -->`)
    expect(OFF_NOTE.split('\n')[0]).toBe('<!-- stretch-off v3 -->')
  })

  test('lastSentIn skips v2 by default and finds it with anyVersion', async () => {
    const v2 = guide(DEFAULT_SHORT_WORDS).replace('stretch-guide v3', 'stretch-guide v2')
    const v2Off = OFF_NOTE.replace('stretch-off v3', 'stretch-off v2')
    expect(lastSentIn(v2)).toBeUndefined()
    expect(lastSentIn(v2, true)).toEqual({ kind: 'guide', words: DEFAULT_SHORT_WORDS })
    expect(lastSentIn(`prompt.submit hook additional context: ${v2}`, true)).toEqual({ kind: 'guide', words: DEFAULT_SHORT_WORDS })
    expect(lastSentIn(`${v2}\n${v2Off}`, true)).toEqual({ kind: 'off' })
    expect(lastSentIn(`${v2Off}\n${guide(90)}`)).toEqual({ kind: 'guide', words: 90 })
    expect(lastSentIn(`${guide(90)}\n${v2Off}`)).toEqual({ kind: 'guide', words: 90 })
    // A later version number is not v3.
    expect(lastSentIn('<!-- stretch-guide v30 n=150 -->')).toBeUndefined()
  })
})

type Api = { role: 'user' | 'assistant'; content: { type: string; text?: string }[] }
const user = (...texts: string[]): Api => ({ role: 'user', content: texts.map(text => ({ type: 'text', text })) })
const assistant = (text: string): Api => ({ role: 'assistant', content: [{ type: 'text', text }] })
const conversation = (on: On, api: () => Api[]) => {
  const contexts: (readonly string[] | undefined)[] = []
  on('session.messages', ($, e) => ({ value: (e.as === 'api' ? api() : []) as never }))
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  return contexts
}
const submit = ($: Engine, text = 'next') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
const V2_GUIDE = guide(DEFAULT_SHORT_WORDS).replace('stretch-guide v3', 'stretch-guide v2')

describe('guide: a transcript holding only a v2 guide', () => {
  test('gets the v3 guide on its next prompt, and only once', async ($, on) => {
    let api: Api[] = [user('first', V2_GUIDE), assistant('Answer.')]
    const contexts = conversation(on, () => api)
    await submit($)
    expect(contexts[0]).toEqual([guide(DEFAULT_SHORT_WORDS)])
    api = [...api, user('next', guide(DEFAULT_SHORT_WORDS)), assistant('Answer.')]
    await submit($)
    expect(contexts[1]).toBeUndefined()
  })
})

describe('defect: a v2 guide and stretch turned off', () => {
  // guideNote sends the off note only when a current-version guide stands last, so a session
  // that holds a v2 guide is never told to stop using the markup.
  test('the next prompt carries the off note', async ($, on) => {
    mock.store(on)
    const contexts = conversation(on, () => [user('first', V2_GUIDE), assistant('Answer.')])
    await $.command.run({ command: 'stretch', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 100 } })
    await submit($)
    expect(contexts[0]).toEqual([OFF_NOTE])
  })
})
