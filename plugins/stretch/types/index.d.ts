declare module 'claude-code' {
  interface PluginState {
    stretch: {
      /** Per paragraph of a reply: the keys of the stretches the reader has open. */
      open: StateFamily<string[]>
      /** The stretches the reader opened since their last prompt: the reply's request id and the short form. */
      seen: { requestId: string; short: string }[]
      /** Per tool group: whether the reader unfolded it. */
      groups: StateFamily<boolean>
      /** Per reply: the count each open stretch was opened at (picks its colour), and the next count. */
      order: StateFamily<{ order: Record<string, number>; count: number }>
      /** The request id of the reply where a stretch was opened last, until the next prompt; empty for none. */
      newest: string
      /** Request ids of every reply drawn with stretches this session, newest last, at most 1000. */
      drawn: string[]
      /** Request ids of replies first drawn since the last prompt: the latest reply. */
      latest: string[]
    }
  }
}
