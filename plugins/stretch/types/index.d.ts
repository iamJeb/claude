declare module 'claude-code' {
  interface PluginState {
    stretch: {
      /** Per paragraph of a reply: the keys of the stretches the reader has open. */
      open: StateFamily<string[]>
      /** The stretches the reader opened since their last prompt: the reply's request id and the short form. */
      seen: { requestId: string; short: string }[]
      /** Per tool group: how the reader last set its own toggle, and the `groupsAll` id current then. It counts only while that id is still current. */
      groups: StateFamily<{ isOpen: boolean; at: number }>
      /** The last show all or fold all over tool groups: its number, and which way. A group with no own toggle since follows it. */
      groupsAll: { id: number; isOpen: boolean }
      /** Per reply: the count each open stretch was opened at (picks its colour), and the next count. */
      order: StateFamily<{ order: Record<string, number>; count: number }>
      /** The request id of the reply where a stretch was opened last, until the next prompt; empty for none. */
      newest: string
      /** Request ids of every reply drawn with stretches this session, newest last, at most 1000. */
      drawn: string[]
      /** Request ids of replies first drawn since the last prompt: the latest reply. */
      latest: string[]
      /** The last /stretch open-all or close-all: its number, which way, and the request ids of the reply it opens or closes. */
      bulk: { id: number; action: 'open' | 'close'; requestIds: string[] }
      /**
       * Per paragraph of a reply drawn by a Client: the stretch the reader last asked to open or close
       * from the keyboard, numbered so each ask acts once; null before any.
       */
      ask: StateFamily<{ key: string; action: 'open' | 'close'; n: number } | null>
      /**
       * While letters show, until the next edit or other change to the prompt, a submitted prompt or
       * their chord again: whether they open or close, and each one's stretch, by paragraph member
       * and stretch key; null while none show.
       */
      lettering: { action: 'open' | 'close'; targets: { letter: string; member: string; key: string }[] } | null
      /** The style the toolbar is trying (marks, highlight: a hex colour, `tinted` or empty), drawn in place of the saved one until saved; null for none. */
      look: { marks: string[]; highlight: string } | null
      /** Whether /stretch style has the toolbar open. */
      toolbar: boolean
      /** Which action holds the toolbar's one-at-a-time claim, a save or a close; null while none does. */
      busy: 'save' | 'close' | null
    }
  }
}
