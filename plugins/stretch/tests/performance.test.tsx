import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { widthOf } from '../hooks/layout'
import { paragraphsOf, parse, stretches } from '../hooks/parse'

declare const console: { log(...values: unknown[]): void }

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }
const LONG = { timeoutMs: 180000 }

const mount = ($: Engine, text: string) =>
  $.ui.mount({
    plugin: 'stretch',
    surface: 'terminal',
    component: 'AssistantMessage',
    props: { text, isFirstOfReply: true },
    requestId: 'reply-1',
    viewport: FULLSCREEN,
  })
type Mounted = Awaited<ReturnType<typeof mount>>

const textOf = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && node !== null && 'children' in node) return textOf(node.children)
  return ''
}
const rowsOf = async (ui: Mounted): Promise<string[]> => {
  const tree = await ui.drawn({ in: 'paragraph-0' })
  const children: unknown = 'children' in tree ? tree.children : []
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).map(textOf)
}

/** Mounts `text`, opens the first three stretches showing `short`, and times the mount, each press and each frame. */
const measure = async ($: Engine, text: string, short: string, requestId: string) => {
  const t0 = Date.now()
  const ui = await $.ui.mount({ plugin: 'stretch', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, requestId, viewport: FULLSCREEN })
  const tree = await ui.drawn({ in: 'paragraph-0' })
  const mountMs = Date.now() - t0
  expect(JSON.stringify(tree).length).toBeLessThan(100000)
  const presses: number[] = []
  const frames: number[] = []
  for (let k = 0; k < 3; k++) {
    const rows = await rowsOf(ui)
    const y = rows.findIndex(row => row.includes(short))
    const row = rows[y] ?? ''
    const t1 = Date.now()
    await ui.pointer({ type: 'down', x: widthOf(row.slice(0, row.indexOf(short))), y, button: 'left', in: 'paragraph-0' })
    presses.push(Date.now() - t1)
    for (let f = 0; f < 5; f++) {
      const t2 = Date.now()
      await ui.advance(16)
      frames.push(Date.now() - t2)
    }
    await ui.advance(2000)
  }
  const after = (await rowsOf(ui)).join(' ')
  await ui.unmount()
  frames.sort((a, b) => a - b)
  return { mountMs, pressMax: Math.max(...presses), frameMedian: frames[Math.floor(frames.length / 2)] ?? 0, frameMax: frames.at(-1) ?? 0, after }
}

test('a 20,000 character paragraph with 200 stretches mounts and opens within budget', LONG, async $ => {
  const small = await measure($, 'A short reply {{with one stretch|with one stretch that opens}} only.', 'with one stretch', 'small')

  const unit = 'It {{retries the call|retries the failed call three times with backoff}} and **fails** out. '
  let text = ''
  for (let i = 0; i < 200; i++) text += unit
  text = text.padEnd(20000, ' word')
  expect(stretches(parse(text)).length).toBe(200)
  const big = await measure($, text, 'retries the call', 'big')
  expect(big.after).toContain('retries the failed call three times with backoff «')

  let mid = ''
  while (mid.length < 3500) mid += unit
  const animated = await measure($, mid, 'retries the call', 'mid')
  expect(animated.after).toContain('retries the failed call three times with backoff «')

  console.log(`TIMING small reply: mount ${small.mountMs} ms, frame median ${small.frameMedian} ms, max ${small.frameMax} ms`)
  console.log(`TIMING 20k reply: mount ${big.mountMs} ms, press max ${big.pressMax} ms, frame median ${big.frameMedian} ms, max ${big.frameMax} ms`)
  console.log(`TIMING 3.5k reply (animated): mount ${animated.mountMs} ms, frame median ${animated.frameMedian} ms, max ${animated.frameMax} ms`)
  expect(big.mountMs).toBeLessThan(3000)
})

test('a tree that would pass the engine bounds falls back to open markdown instead of unmounting', LONG, async $ => {
  const unit = '`a` **b** *c* {{d|the dee}} '
  let text = ''
  while (text.length < 20000) text += unit
  const ui = await mount($, text)
  const tree = await ui.drawn({ in: 'paragraph-0' })
  const serialized = JSON.stringify(tree)
  expect(serialized.length).toBeLessThan(100000)
  expect(serialized).toContain('the dee')
  await ui.unmount()
})

test('many unclosed {{ parse in bounded time', async () => {
  let text = ''
  for (let i = 0; i < 2000; i++) text += `see {{x${i} and more prose here `
  text += ' {{a|the alpha}}'
  const t0 = Date.now()
  paragraphsOf(text)
  const found = stretches(parse(text))
  const ms = Date.now() - t0
  console.log(`TIMING 2000 unclosed, ${text.length} chars: ${ms} ms`)
  expect(found.map(s => s.short)).toEqual(['a'])
  expect(ms).toBeLessThan(2000)
})
