# statusline

Status line for [Claude Code](https://claude.com/claude-code) built around one
question: **will my quota last the week?**

```
 my-project  Opus 5  high     ctx ██▎░░░░░  29% ▁7▂6▃5▃4▄3█2▅1 ▬ 49h 08m
│▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄│ ┌ 5h  ██▊░│░░░  35% ·5 ▄4 ▆3 ·2 ·1   2h 29m
▄base 77  ▄Bash 18  ▄mine 3        └ wk  █┃░░░░░░  18% ▆t·w·t·f·s·s·m   6d 01h
```

## Install / update on any machine

```sh
curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh | bash
```

Needs only `curl` and `python3` (3.8+, standard library). Copies five scripts to
`~/.claude/` and sets `statusLine` in `~/.claude/settings.json`, backing the file up
first and writing it atomically. Safe to re-run to update. Aborts without touching
anything if `settings.json` isn't valid JSON.

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

A `·` means **not sampled**, not "idle" — `rate_limits` only refresh on an API
response, so the stretch right after a window rolls over is always unobserved.

### The burn bar

One stacked bar: **share of context re-read burden**. Every turn re-reads the whole
context, so a block added 40 turns ago has been paid for 40 times. Each source scores
`size × turns-it-has-persisted`, which is what decides whether the week lasts — not
what looks big in the scrollback.

`base` is system prompt + tool definitions + loaded skills + `CLAUDE.md` + memory
files. It's resident from turn one, so it usually dominates. **`/clear` does not
reduce `base`** — a fresh session pays it again. What reduces it is loading fewer and
smaller skills.

It's a **share, not a price**: no dollar amounts, token rates, or model IDs appear
anywhere in the calculation, so it stays correct across model and pricing changes.
`CLAUDE_STATUSLINE_BURN=convo` drops `base` and shows only what your own behaviour
controls.

## Options

Environment variables — no code edits.

| Variable | Default | Effect |
|---|---|---|
| `CLAUDE_STATUSLINE_SEP` | `` (U+E0B0) | Powerline separator. **Empty = colour-only, no Nerd Font needed** |
| `CLAUDE_STATUSLINE_BURN` | `all` | `convo` excludes fixed overhead |
| `CLAUDE_STATUSLINE_SAFE` | off | `1` = ASCII only |
| `CLAUDE_STATUSLINE_LAYOUT` | `inline` | `stacked` puts the header on its own row |
| `CLAUDE_STATUSLINE_PALETTE` | `job` | `legacy` = the old green→red-everywhere ramp |
| `CLAUDE_STATUSLINE_SEP_COLS` | `1` | `2` if your terminal draws the separator double-width |

## Notes

- **Nerd Font.** The default separator is a Private Use Area glyph with no fallback —
  it shows as a box without a patched font. The font goes on the machine running the
  *terminal*, not a remote host you SSH into. `CLAUDE_STATUSLINE_SEP=""` avoids it
  entirely.
- **State.** The status line payload is point-in-time, so time-based charts need it:
  `~/.claude/statusline-history.json` (quota windows keyed by `resets_at`, so they
  reset themselves) and `~/.claude/statusline-cache/<session>.json` (a byte offset
  into the transcript, so each refresh re-parses only what was appended). All of it is
  best-effort — if it fails the charts dim out and the row still prints.
- **Cost.** ~25 ms per invocation warm.
- **Strips fill in going forward.** Expect mostly dots for the first hour or two after
  installing. That's history accumulating, not a fault.
- `statusline-doctor.py` diagnoses rendering problems; `statusline-preview.py` renders
  every state without touching live history; `statusline-gallery.py` shows the
  terminal chart idioms this is built from.

## Colour

Assigned by the job each mark does, not by taste:

- **Meters** wear a fixed four-step **status** scale (good/warning/serious/critical).
  Safe because bar length and a printed number carry the same information.
- **Heat tiles** wear a single-hue **sequential** ramp, monotonic in lightness, with
  height as the primary channel — colour is never load-bearing alone.
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
