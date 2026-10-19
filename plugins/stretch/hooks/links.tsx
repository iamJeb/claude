import type { ClientModule, ClientSurface } from 'claude-code'

import { widthOf } from './layout'

// Draws one row of pressable links for the hooks module: the open all and close all under a reply,
// and the show and fold toggles beside a folded tool group. The engine's own Markdown shows a link
// with its address, and the plugin's addresses are internal, so the row is drawn here instead:
// each label underlined, as a pressable phrase in a paragraph is, and a press posts the address
// of the label under it for the hooks module to answer.

/** One link of the row: the address the hooks module answers, and the words drawn for it. */
export type Link = { href: string; label: string }

/** The links of the row, and a note drawn dim after them, such as a count. */
export type LinksProps = { links: Link[]; note?: string }

/** What a press posts to the hooks module: the address of the label pressed. */
export type LinksPost = { href: string }

const BETWEEN = ' · '
const BEFORE_NOTE = '  '

// The props each instance last drew, so a press reads the labels on screen now.
const shown = new WeakMap<object, LinksProps>()
// The address under the left button's last down, so a press lands only where the button comes up on the same label.
const downOn = new WeakMap<object, string>()

const Links: ClientModule<LinksProps, true> = (props, surface) => {
  const { Box, Text } = surface.elements
  shown.set(surface, props)
  if (surface.state === undefined) {
    surface.setState(true)
    surface.onPointer(event => {
      if (event.button !== 'left') return
      if (event.type === 'down') {
        const href = hrefAt(surface, event.x, event.y)
        if (href === undefined) downOn.delete(surface)
        else downOn.set(surface, href)
      } else if (event.type === 'up') {
        const href = downOn.get(surface)
        downOn.delete(surface)
        if (href !== undefined && hrefAt(surface, event.x, event.y) === href) surface.post({ href } satisfies LinksPost)
      }
    })
  }

  return (
    <Box flexDirection="row">
      <Text wrap="truncate">
        {props.links.map((link, i) => [i === 0 ? '' : BETWEEN, <Text underline>{link.label}</Text>])}
        {props.note === undefined ? '' : [BEFORE_NOTE, <Text dimColor>{props.note}</Text>]}
      </Text>
    </Box>
  )
}

export default Links

/** The link drawn under column `x` of the row, or undefined where none is. */
export function linkUnder(links: readonly Link[], x: number): Link | undefined {
  let at = 0
  for (const [i, link] of links.entries()) {
    if (i > 0) at += widthOf(BETWEEN)
    const to = at + widthOf(link.label)
    if (x >= at && x < to) return link
    at = to
  }

  return undefined
}

function hrefAt(surface: ClientSurface<true>, x: number, y: number): string | undefined {
  return y === 0 ? linkUnder(shown.get(surface)?.links ?? [], x)?.href : undefined
}
