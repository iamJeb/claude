// How a reply wraps and grows in scripts that write no spaces between words, or none between
// characters: Chinese and Japanese break between characters, Korean at spaces, Thai between words,
// and a stretch in those scripts grows a piece at a time around the words already read.

import { describe, expect, test } from 'claude-code/testing'

import { grow } from '../hooks/grow'
import { breakables, layout, widthOf } from '../hooks/layout'

const rows = (text: string, width: number) => layout(text, width).map(row => row.map(run => run.text).join(''))
const STEPS = 40
const frames = (short: string, long: string) => Array.from({ length: STEPS + 1 }, (_, i) => grow(short, [long], i / STEPS, () => ''))
/** Each `a b` in a frame whose space the long form does not have beside `a` or `b`. */
const addedSpaces = (shown: string[], long: string) =>
  shown.flatMap(frame => [...frame.matchAll(/(\S) (?=(\S))/gu)].filter(([, a, b]) => !long.includes(`${a} `) && !long.includes(` ${b}`)))

describe('Chinese', () => {
  test('fills a row before breaking between characters', async () => {
    expect(rows('ab 一二三四五', 10)).toEqual(['ab 一二三', '四五'])
  })

  test('keeps closing punctuation off the start of a row', async () => {
    expect(rows('一二三四五，六', 10)).toEqual(['一二三四', '五，六'])
    expect(rows('一二三四五。六', 10)).toEqual(['一二三四', '五。六'])
  })

  test('keeps opening punctuation off the end of a row', async () => {
    expect(rows('一二三四「五六」', 10)).toEqual(['一二三四', '「五六」'])
  })

  test('breaks beside a Latin word, never inside it', async () => {
    expect(rows('写给我的Claude看', 10)).toEqual(['写给我的', 'Claude看'])
  })

  test('grows its long form around its short form over many frames, with no space the long form lacks', async () => {
    const long = '《道德经》的核心是道，也就是万物运行的根本规律，与人顺着道去做事的无为。'
    const shown = frames('核心是道，与无为。', long)
    expect(shown[0]).toBe('核心是道，与无为。')
    expect(shown.at(-1)).toBe(long)
    expect(new Set(shown).size).toBeGreaterThan(10)
    expect(addedSpaces(shown, long)).toEqual([])
    const mixed = '核心是道，也就是万物运行的 root rule 根本规律，与人顺着道去做事的无为。'
    expect(addedSpaces(frames('核心是道，与无为。', mixed), mixed)).toEqual([])
  })

  test('the short form\'s characters stay where they are while the long form grows', async () => {
    const long = '《道德经》的核心是道，也就是万物运行的根本规律，与人顺着道去做事的无为。'
    for (const frame of frames('核心是道，与无为。', long)) {
      // Every character of the short form is in every frame, in order.
      let at = -1
      for (const ch of '核心是道，与无为。') {
        at = frame.indexOf(ch, at + 1)
        expect(at).toBeGreaterThan(-1)
      }
    }
  })

  test('keeps ASCII punctuation and brackets with the characters they belong to', async () => {
    expect(rows('你好你好你,world', 10)).toEqual(['你好你好', '你,world'])
    expect(rows('一二三(四)Claude', 10)).toEqual(['一二三(四)', 'Claude'])
  })

  test('breakables cuts between characters and keeps punctuation with its neighbour', async () => {
    expect(breakables('一二三，四')).toEqual(['一', '二', '三，', '四'])
    expect(breakables('「一二」')).toEqual(['「一', '二」'])
    expect(breakables('plain word')).toEqual(['plain word'])
  })
})

describe('Japanese', () => {
  test('keeps a small kana and the long-vowel mark off the start of a row', async () => {
    expect(rows('あいうえおっと', 10)).toEqual(['あいうえ', 'おっと'])
    expect(rows('あいうえコーヒー', 10)).toEqual(['あいうえ', 'コーヒー'])
  })

  test('a combining voiced mark takes no cell and never starts a row', async () => {
    expect(widthOf('が')).toBe(2)
    expect(rows('一二三四が', 10)).toEqual(['一二三四が'])
    expect(rows('一二三四がa', 10)).toEqual(['一二三四', 'がa'])
  })

  test('grows a character at a time', async () => {
    const long = 'この本の核心は道、つまり万物の根本原理に従う無為である。'
    const shown = frames('核心は道、無為である。', long)
    expect(shown[0]).toBe('核心は道、無為である。')
    expect(shown.at(-1)).toBe(long)
    expect(new Set(shown).size).toBeGreaterThan(6)
    expect(addedSpaces(shown, long)).toEqual([])
  })
})

describe('Korean', () => {
  test('breaks at spaces and keeps each word whole', async () => {
    expect(rows('가나다 라마바사', 10)).toEqual(['가나다', '라마바사'])
  })
})

describe('Thai', () => {
  test('vowel and tone marks take no cell', async () => {
    expect(widthOf('สวัสดี')).toBe(4)
    expect(rows('สวัสดีครับ ผม', 10)).toEqual(['สวัสดีครับ ผม'])
  })

  test('breaks between words, which Thai writes without spaces', async () => {
    expect(rows('สวัสดีครับผมชื่อสมชาย', 10)).toEqual(['สวัสดีครับผม', 'ชื่อสมชาย'])
  })

  test('grows its long form a word at a time around its short form', async () => {
    const long = 'แนวคิดหลักของคัมภีร์นี้คือการใช้ชีวิตตามเต๋า'
    const shown = frames('แนวคิดหลักคือเต๋า', long)
    expect(shown[0]).toBe('แนวคิดหลักคือเต๋า')
    expect(shown.at(-1)).toBe(long)
    expect(new Set(shown).size).toBeGreaterThan(4)
    expect(addedSpaces(shown, long)).toEqual([])
  })
})

describe('a character drawn as a picture', () => {
  // The rocket, U+1F680, written as an escape so the file holds plain text.
  const ROCKET = '\u{1f680}'

  test('counts as two cells, so a row holds as many as fit', async () => {
    expect(widthOf(ROCKET)).toBe(2)
    expect(rows(`go ${ROCKET} now and ${ROCKET} again`, 12)).toEqual([`go ${ROCKET} now`, `and ${ROCKET} again`])
  })
})
