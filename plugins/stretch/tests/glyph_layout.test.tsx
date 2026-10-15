import { expect, test } from 'claude-code/testing'

import { layout, linkAt } from '../hooks/layout'

const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true }

test('private-use glyphs, emoji and stray noncharacters beside a stretch draw without hanging', async $ => {
  const glyphs = ['\ue000', '\ue001', '\ue002', '\ue003', '\ue004', '\uf8ff', '\u{1F600}', '\ufdd0', '\ufdd3']
  for (const glyph of glyphs) {
    const t0 = Date.now()
    const ui = await $.ui.mount({
      plugin: 'stretch',
      surface: 'terminal',
      component: 'AssistantMessage',
      props: { text: `Status {{a|alpha detail}} then ${glyph} shows.`, isFirstOfReply: true },
      requestId: `r-${glyph.codePointAt(0)}`,
      viewport: FULLSCREEN,
    })
    const tree = await ui.drawn({ in: 'paragraph-0' })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(JSON.stringify(tree)).toContain('Status')
    expect(JSON.stringify(tree)).toContain('shows.')
    await ui.unmount()
  }
})

test('the layout reads a lone mark as text and still finds links', async () => {
  const rows = layout('a \ufdd0 b \ufdd3 c', 40)
  expect(rows.length).toBe(1)
  expect(linkAt(rows, 0, 0)).toBeUndefined()
})
