# statusline

Status line for [Claude Code](https://claude.com/claude-code) built around one
question: **will my quota last the week?**

```
 my-project  Opus 5  high     ctx ██▎░░░░░  29% ▁7▂6▃5▃4▄3█2▅1 ▬ 49h 08m
│▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄│ ┌ 5h  ██▊░│░░░  35% ▃5 ▄4 ▆3 ·2 ·1   2h 29m
▄base 77  ▄Bash 18  ▄mine 3        └ wk  █┃░░░░░░  18% ▆t·w·t·f·s·s·m   6d 01h
```

## Install / update on any machine

```sh
curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh | bash
```

Needs only `curl` and Python 3.8+ (standard library); the installer uses the first of `python3`, `py -3` and `python` that actually runs. Copies five scripts to `~/.claude/` and sets `statusLine` in `~/.claude/settings.json`, backing the file up first and writing it atomically. Safe to re-run to update. Aborts without touching anything if `settings.json` isn't valid JSON.

## Reading it

`python3 ~/.claude/statusline-legend.py` prints an annotated guide. The short form —
three numbers decide anything:

| | |
|---|---|
| `ctx %` | how full the context is — when to `/clear` |
| `5h %` + countdown | whether you can start something big right now |
| `wk %` + pace tick | whether you'll last the week |

**The pace tick `┃` is the least obvious and most useful mark.** It sits where you'd
be if you burned the window evenly. Fill stopping left of it means you're under
budget; fill past it means you'll run dry early. A bare percentage can't tell you
that — 70% used means "relax" on day 6 and "slow down" on day 1.

### The strips

Each cell is two characters: a bar plus a dim axis label, so every strip states its
own x-axis rather than leaving you to guess.

- `ctx` — 7 cells × 10 min, labelled `7`..`1` = tens of minutes ago
- `5h` — 5 cells × 1 hour, labelled `5`..`1` = hours until reset
- `wk` — 7 cells × 1 day, labelled by weekday initial

**Read the height, not the colour.** At one character wide two steps of one hue are
indistinguishable, so height is the primary channel and colour only reinforces it —
the strips stay readable in monochrome. Full height = 2× even pace; half height *is*
even pace. The scale is absolute rather than normalised to each window's own peak, so
a quiet week shows short bars instead of rescaling a trivial day to look alarming.

A `·` means **no sample yet**, not "idle". `rate_limits` only refresh on an API response, so some burn is never watched as it happens: the stretch before the first sample in a window, time with no session open, and use on another device. That burn surfaces at the next sample. Rather than stack it on that one cell as a false spike, the strip spreads it evenly back across the unobserved cells and draws them **grey**: the burn happened somewhere in that stretch, and the strip does not know where.

The `ctx` sparkline is scaled to its own range, but never less than 10 points, so a small wobble stays flat instead of drawing full height.

### The burn bar

One stacked bar: **share of context re-read burden**. Every API call re-reads the whole context, so a block added 40 calls ago has been paid for 40 times. Each source in the transcript scores `size × calls since it arrived`, which is what decides whether the week lasts, not what looks big in the scrollback. API token counts are converted at 4 characters per token so every source shares one unit, and an image counts at about 1.6K tokens rather than its base64 length.

Labels are cut to 4 characters:

- `Bash`, `Read`, `Edit` and the other tools count both the call and its result, since a heredoc script is often bigger than its output.
- `you` is what you typed or pasted, `mine` is the assistant's replies, `thin` is thinking.
- `Agen` is the Agent tool as the main context sees it: the prompt sent to a subagent and the report it returned.
- `@gen`, `@Exp` and so on are the subagents themselves, named `@<agentType>` (`@gen` = general-purpose, `@Exp` = Explore; your own agent types show the same way). Each runs in its own context and bills its own calls, none of which appear in the main transcript, so their real input tokens are summed from `<session>/subagents/agent-*.jsonl`. That already includes each agent's own system prompt and tool definitions.
- `summ` is the summary a `/compact` leaves behind. A `/compact` freezes the cost of everything before it: those sources keep what they had run up but stop growing.
- `base` is everything the transcript cannot show: system prompt, tool definitions, loaded skills, `CLAUDE.md`, memory files and reminders. It is measured rather than estimated, as the session's real input tokens (from the API usage in the transcript, each call counted once by message id) minus everything the transcript does show. It is resident from turn one, so it usually dominates. **`/clear` does not reduce `base`**; a fresh session pays it again. What reduces it is loading fewer and smaller skills.

It's a **share, not a price**: no dollar amounts, token rates, or model IDs appear
anywhere in the calculation, so it stays correct across model and pricing changes.
`CLAUDE_STATUSLINE_BURN=convo` drops `base` and shows only what your own behaviour
controls.

## Options

Environment variables — no code edits.

| Variable | Default | Effect |
|---|---|---|
| `CLAUDE_STATUSLINE_SEP` | U+E0B0 (Nerd Font wedge) | Powerline separator. `◥` needs no font; **empty = colour-only, no Nerd Font needed** |
| `CLAUDE_STATUSLINE_BURN` | `all` | `convo` excludes fixed overhead |
| `CLAUDE_STATUSLINE_SAFE` | off | `1` = ASCII only |
| `CLAUDE_STATUSLINE_LAYOUT` | `inline` | `stacked` puts the header on its own row |
| `CLAUDE_STATUSLINE_PALETTE` | `job` | `legacy` = the old green→red-everywhere ramp |
| `CLAUDE_STATUSLINE_SEP_COLS` | `1` | `2` if your terminal draws the separator double-width |

## Notes

- **Nerd Font.** The default separator is the Nerd Font wedge U+E0B0, a Private Use Area glyph with no fallback, so it needs a Nerd Font and shows as a box without one. The font goes on the machine running the *terminal*, not a remote host you SSH into. To keep your usual terminal font, add a symbols-only Nerd Font as a fallback after it: only the glyphs your font lacks come from the fallback, so the look is otherwise unchanged. `CLAUDE_STATUSLINE_SEP=◥` needs no font, and `CLAUDE_STATUSLINE_SEP=""` drops the separator entirely.
- **Windows.** The installer points `statusLine` at the `py` launcher (or, without one, the Python that ran the installer) and at the script by absolute path, all with forward slashes, because Claude Code runs the command through `sh`, which strips backslashes. The script forces UTF-8 on its own output and reads stdin as bytes, so it needs no `python -X utf8`. Run the helpers as `py -3 ~/.claude/statusline-legend.py` and so on.
- **State.** The status line payload is point-in-time, so time-based charts need it: `~/.claude/statusline-history.json` (quota windows keyed by `resets_at`, so they reset themselves; rewritten only when a sample changes it) and `~/.claude/statusline-cache/<session>.json` (byte offsets into the transcript and its subagent transcripts, so each refresh re-parses only what was appended; a cache untouched for 14 days is deleted, and a format change forces a clean re-parse). All of it is best-effort: if it fails the charts dim out and the row still prints.
- **Cost.** Measured on Windows, about 160 ms per refresh through `py -3` (median of 30 runs), and about 100 ms of that is interpreter and launcher start-up, since `py -3 -c pass` alone takes that long. Pointing the command at `python.exe` directly saves about 50 ms. The transcript is parsed incrementally, so a long session adds little after the first refresh.
- **Strips fill in going forward.** Expect grey bars and dots for the first window or two after installing. That's history accumulating, not a fault.
- `statusline-doctor.py` diagnoses rendering problems; `statusline-preview.py` renders
  every state without touching live history; `statusline-gallery.py` shows the
  terminal chart idioms this is built from.

## Colour

Assigned by the job each mark does, not by taste:

- **Meters** wear a fixed four-step **status** scale (good/warning/serious/critical).
  Safe because bar length and a printed number carry the same information.
- **Heat tiles** wear a single-hue **sequential** ramp, monotonic in lightness, with
  height as the primary channel — colour is never load-bearing alone. Burn nobody observed is drawn grey, outside the ramp.
- **Burn segments** wear **categorical** slots in fixed order, never cycled.

No status colour is reused for magnitude, so a red meter and a tall tile mean
different things without conflicting.

## Editing

On the machine you edit from, symlink the repo copies into place:

```sh
for f in statusline.py statusline-legend.py statusline-preview.py \
         statusline-doctor.py statusline-gallery.py; do
  ln -sf "$PWD/$f" ~/.claude/$f
done
```

The installer detects symlinks and refuses to overwrite through them, so running the
curl one-liner on that machine won't clobber your working copy.
