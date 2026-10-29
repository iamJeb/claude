// The marks that start a markdown block on a line, as the rules read a reply's lines. They are kept
// here rather than taken from the plugin's layout, which node cannot load.
export const TABLE_ROW = /^\s*\|/
export const HEADING = /^#{1,6}\s+(.*)$/
export const QUOTE = /^>\s?(.*)$/
export const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
