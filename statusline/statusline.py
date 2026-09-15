#!/usr/bin/env python3
"""Claude Code status line: context + quota, with burn attribution.

One table. The powerline header sits on row 1 and the remaining rows indent to
line up under it, so all three metrics share the same columns:

     my-project  Opus 5  high    ctx █▎░░░░░░  17% ·7·6·5▁4▂3▆2█1 ⇈  7h 14m
                              ┌ 5h  ██████┃░  78%     █5█4█3█2█1     40m
                              └ wk  █████▌░│  70% █t█w█t█f█s█s█m 19h 50m

Columns: rail · label · meter · percent · series · trend · time

The series column is 7 (or 5) cells of TWO characters: a value glyph plus a dim
axis label, so each strip states its own x-axis instead of leaving you to guess.
All three are RIGHT-aligned in the column because their right edges share a
meaning - ctx ends at now, the quota strips end at their reset.

    ctx   7 cells x 10 min  labelled 7..1 = tens of minutes ago (last 70 min)
    5h    5 cells x 1 hour  labelled 5..1 = hours remaining, reset at right edge
    wk    7 cells x 1 day   labelled by weekday initial

A cell's glyph is its BURN in that cell (quota rows) or the context level at
that moment (ctx row) - not a running total. The meter's │/┃ tick is the pace
marker: fill left of it means you are under even burn for the window.

Everything is optional: rate_limits appear only for Pro/Max and only after the
first API response; context_window is null before the first call.

History: the payload is point-in-time, so time-based charts need state. We keep
a small JSON file keyed by each window's resets_at, which means buckets map onto
the REAL 5h/7d window and reset themselves when the window rolls over. Context
is stored as timestamped (t, pct) pairs so its x-axis is real time, and an idle
stretch reads as a flat line rather than a gap. All history I/O is best-effort -
if it fails the charts dim out and the row still prints.
"""

import json
import os
import re
import sys
import tempfile
import time

# ---------------------------------------------------------------- config ----
# Separator for the powerline header.
#   ""  true powerline wedge  - REQUIRES a Nerd Font on the CLIENT
#   "◥"  ◥ upper-right triangle - standard Unicode, no install  (default)
#   "▐"  ▐ right half block     - standard Unicode, no install
#   ""        none, colour change only
SEP = os.environ.get("CLAUDE_STATUSLINE_SEP", "\ue0b0")

# How many terminal cells SEP actually occupies. Nerd Font powerline glyphs are
# single-width. Standard-Unicode fallbacks like ◥ ▐ are East-Asian AMBIGUOUS and
# some terminals render them 2 cells wide - which shifts the header and breaks
# the indent under it. If rows 2-3 don't sit under row 1, set this to 2.
SEP_COLS = int(os.environ.get("CLAUDE_STATUSLINE_SEP_COLS", "1") or 1)

# inline  = header on row 1 with the first chart row beside it (default)
# stacked = header on its own row, table underneath
LAYOUT = os.environ.get("CLAUDE_STATUSLINE_LAYOUT", "inline")

HISTORY = os.environ.get(
    "CLAUDE_STATUSLINE_HISTORY", os.path.expanduser("~/.claude/statusline-history.json")
)

# SAFE=1 -> ASCII only: no powerline fills, no block/box/braille glyphs, no
# indent. If this renders correctly and the normal mode does not, the problem is
# glyph width or font coverage in the terminal, not this script's layout.
SAFE = os.environ.get("CLAUDE_STATUSLINE_SAFE", "") not in ("", "0", "no", "false")

# "job"    - colour by the job each mark does: STATUS (fixed 4-step good/warning/
#            serious/critical) for the meters, SEQUENTIAL (one hue, blue, dark->
#            bright on a dark surface) for the heat tiles. Default.
# "legacy" - the original smooth green->amber->red ramp on everything.
PALETTE = os.environ.get("CLAUDE_STATUSLINE_PALETTE", "job")

# "all"   - include `base` (system prompt + tool defs + skills + memory). Honest,
#           but it dominates every session because it is fixed and always resident.
# "convo" - conversation only, i.e. just the part your behaviour changes.
BURN_SCOPE = os.environ.get("CLAUDE_STATUSLINE_BURN", "all")

NAME_MAX = 14      # session title is truncated to this
HEADER_W = 34      # header is padded to this so the gutter under it is stable
# the burn bar fills whatever the gutter gives it (set at render time)
CACHE_DIR = os.path.expanduser("~/.claude/statusline-cache")
MAX_TRANSCRIPT = 64 * 1024 * 1024      # refuse to parse a pathological transcript
BAR_W = 8          # meter width
SERIES_W = 14      # series column width - shared so columns align
# Each series cell is 2 chars: a value glyph plus a dim axis label. All three
# strips are RIGHT-aligned in the column, so their right edges share a meaning:
# ctx -> now, 5h -> reset, wk -> reset.
CTX_CELLS, CTX_CELL_S = 7, 600      # 7 x 10min = last 70 minutes
H5_CELLS = 5                        # 5 x 1h, labelled by hours-until-reset
WK_CELLS = 7                        # 7 x 1 day, labelled by weekday letter
MAX_INDENT = 48    # cap the row-2/3 indent if the header runs long
FIVE_H = 5 * 3600
SEVEN_D = 7 * 86400
# SERIES_W buckets across each window: 5h -> ~21min cells, 7d -> 12h cells

# ---------------------------------------------------------------- colour ----
R = "\033[0m"
DIM = "\033[38;5;243m"
FAINT = "\033[38;5;238m"
LABEL = "\033[38;5;245m"
INK = "\033[38;2;18;18;22m"      # text on a filled powerline segment

C_NAME = (110, 160, 220)
C_MODEL = (180, 140, 220)
C_EFFORT = (120, 190, 175)

if SAFE:
    EIGHTHS = " " * 8      # no sub-cell precision in ASCII
    FULL, EMPTY = "#", "."
    SPARK = "_.-=+*#"
    HEAT_ON, HEAT_OFF, HEAT_ZERO = "#", ".", "-"
    CELL_ON = "#"
    RAIL_TOP, RAIL_BOT = "/", "\\"
    GUT_BAR, GUT_CAP, GUT_EMPTY = "=", "|", "-"
    TICK_FULL, TICK_EMPTY = "!", "!"
    ELLIPSIS = "~"
    TREND = (">>", " ^", " v", " -", " .")
else:
    EIGHTHS = " ▏▎▍▌▋▊▉"   # 1/8 .. 7/8 left blocks
    FULL, EMPTY = "█", "░"
    SPARK = "▁▂▃▄▅▆▇█"
    HEAT_ON, HEAT_OFF, HEAT_ZERO = "■", "·", "▪"
    CELL_ON = "█"
    RAIL_TOP, RAIL_BOT = "┌", "└"
    # lower-half block: the mark sits at the BOTTOM of its cell, leaving the top
    # half empty. That is the only way to get a sub-line gap on a character grid,
    # and it stops the bar merging into the filled powerline row above it.
    GUT_BAR, GUT_CAP, GUT_EMPTY = "▄", "│", "▁"
    TICK_FULL, TICK_EMPTY = "┃", "│"
    ELLIPSIS = "…"
    TREND = ("⇈", "▲", "▼", "▬", "·")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def visible_width(s):
    """Printed width, ignoring colour escapes. Every glyph we emit is 1 cell."""
    return len(ANSI.sub("", s))


def fg(c):
    return f"\033[38;2;{c[0]};{c[1]};{c[2]}m"


def bg(c):
    return f"\033[48;2;{c[0]};{c[1]};{c[2]}m"


def ramp(pct):
    """Green -> amber -> red, as a smooth truecolor ramp."""
    p = max(0.0, min(1.0, pct / 100.0))
    if p < 0.5:
        t = p / 0.5
        return (int(90 + 155 * t), int(190 - 20 * t), 90)
    t = (p - 0.5) / 0.5
    return (245, int(170 - 110 * t), int(90 - 10 * t))


# STATUS - a small fixed scale with reserved meaning. Used only where a
# non-colour cue rides along (bar length + the printed %), never colour-alone.
STATUS_STEPS = ((0, (12, 163, 12)), (50, (250, 178, 25)),
                (75, (236, 131, 90)), (90, (208, 59, 59)))

# SEQUENTIAL - one hue, blue, monotonic in lightness. Anchored dark on a dark
# surface so "more" reads as "brighter". Darkest step clears 2.3:1 on #121212.
SEQ_STEPS = ((24, 79, 149), (37, 106, 191), (57, 135, 229),
             (109, 167, 236), (158, 197, 244), (205, 226, 251))

SPARK_INK = "\033[38;5;110m"   # one muted ink - the glyph HEIGHT carries the value


def status(pct):
    """Colour for a state. Snaps to a step so a threshold crossing is visible."""
    out = STATUS_STEPS[0][1]
    for thr, rgb in STATUS_STEPS:
        if pct >= thr:
            out = rgb
    return fg(out)


def seq(t):
    """Colour for a magnitude, t in 0..1. Interpolated along the single hue."""
    t = max(0.0, min(1.0, t)) * (len(SEQ_STEPS) - 1)
    i = min(int(t), len(SEQ_STEPS) - 2)
    a, b, f = SEQ_STEPS[i], SEQ_STEPS[i + 1], t - int(t)
    return fg(tuple(int(a[k] + (b[k] - a[k]) * f) for k in range(3)))


# CATEGORICAL - identity, not magnitude. Fixed order, never cycled; a 9th
# source folds into "other". Dark-surface steps of the reference palette.
CAT_SLOTS = ((57, 135, 229), (217, 89, 38), (25, 158, 112), (201, 133, 0),
             (213, 81, 129), (0, 131, 0), (144, 133, 233), (230, 103, 103))
CAT_OTHER = (110, 110, 118)


def burn_state(sid, path, now):
    """What is costing quota, by source, weighted by how long it has persisted.

    Quota burn is context x turns: every turn re-reads the whole context, so a
    block added at turn 10 of 50 is paid for 40 more times. Per source we keep
    s  = sum of sizes and si = sum of size*turn_added, which makes the weighted
    share incrementally computable as  T*s - si  for the current turn count T.

    The transcript is parsed INCREMENTALLY from a byte offset cached per
    session, so the 10s refresh re-reads only what was appended.
    """
    if not sid or not path or not os.path.exists(path):
        return None
    cache = os.path.join(CACHE_DIR, f"{sid}.json")
    st = {"off": 0, "T": 0, "names": {}, "src": {}}
    try:
        with open(cache) as fh:
            got = json.load(fh)
        if isinstance(got, dict) and "src" in got:
            st = got
    except Exception:
        pass

    size = os.path.getsize(path)
    if size > MAX_TRANSCRIPT:
        return None
    if size < st["off"]:                      # transcript replaced - start over
        st = {"off": 0, "T": 0, "names": {}, "src": {}}
    if size > st["off"]:
        try:
            with open(path, "r", errors="replace") as fh:
                fh.seek(st["off"])
                for line in fh:
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    m = d.get("message") or {}
                    if d.get("type") == "assistant" and (m.get("usage") or {}):
                        st["T"] += 1
                    c = m.get("content")
                    if not isinstance(c, list):
                        continue
                    for blk in c:
                        if not isinstance(blk, dict):
                            continue
                        bt = blk.get("type")
                        if bt == "tool_use":
                            # the COMMAND counts too - a heredoc script is often
                            # larger than the output it produces
                            src = blk.get("name", "tool")
                            st["names"][blk.get("id")] = src
                            n = len(json.dumps(blk.get("input", {})))
                        elif bt == "tool_result":
                            src = st["names"].get(blk.get("tool_use_id"), "tool")
                            body = blk.get("content")
                            n = len(body) if isinstance(body, str) else len(json.dumps(body))
                        elif bt == "text":
                            src = "mine" if d.get("type") == "assistant" else "you"
                            n = len(blk.get("text", ""))
                        elif bt == "thinking":
                            src, n = "think", len(blk.get("thinking", ""))
                        else:
                            continue
                        acc = st["src"].setdefault(src, [0, 0])
                        acc[0] += n
                        acc[1] += n * st["T"]
                st["off"] = fh.tell()
            if len(st["names"]) > 400:        # only recent ids are ever resolved
                st["names"] = dict(list(st["names"].items())[-200:])
            os.makedirs(CACHE_DIR, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, prefix=".c")
            with os.fdopen(fd, "w") as fh:
                json.dump(st, fh, separators=(",", ":"))
            os.replace(tmp, cache)
        except Exception:
            return None

    T = max(1, st["T"])
    w = {k: max(0, T * v[0] - v[1]) for k, v in st["src"].items()}
    chars = sum(v[0] for v in st["src"].values())
    w = {k: v for k, v in w.items() if v > 0}
    return (sorted(w.items(), key=lambda kv: -kv[1]), chars, T) if w else None


def with_overhead(burn, data):
    """Fold in the fixed context nobody can see in the transcript.

    System prompt + tool definitions + loaded skills + CLAUDE.md + MEMORY.md are
    resident from turn one and re-read every turn, so they are usually the single
    largest cost - and they never appear in the transcript. Infer them as
    (resident context) - (message content) and weight them across ALL turns.
    """
    if not burn:
        return None
    sources, chars, T = burn
    ctx = data.get("context_window") or {}
    resident = ctx.get("total_input_tokens")
    if not resident:
        size, pct = ctx.get("context_window_size"), ctx.get("used_percentage")
        resident = (size * pct / 100.0) if size and pct is not None else None
    if resident and BURN_SCOPE != "convo":
        base = max(0.0, resident * 4 - chars)     # tokens -> chars, same units
        if base > 0:
            sources = sorted(sources + [("base", base * T)], key=lambda kv: -kv[1])
    return sources


def gutter(burn, w):
    """Stacked bar + legend for what is burning quota. Returns 2 rows.

    The bar spans the whole gutter: width is derived from the space available,
    not a fixed constant, so it never leaves the room it has unused.
    """
    bar_w = max(8, w - 2)                      # just the two end caps
    frame = lambda body: f"{DIM}{GUT_CAP}{R}{body}{DIM}{GUT_CAP}{R}"
    if not burn:
        return (frame(f"{FAINT}{GUT_EMPTY * bar_w}{R}"),
                f"{FAINT}no transcript data{R}")
    total = sum(v for _, v in burn) or 1
    top = [(n, v) for n, v in burn[:4] if v / total >= 0.01]
    rest = sum(v for _, v in burn[len(top):])
    if rest / total >= 0.01:
        top = top + [("etc", rest)]

    seg, bar = [], ""
    for i, (name, v) in enumerate(top):
        n = max(1, round(v / total * bar_w))
        seg.append((name, v, n, CAT_OTHER if name == "etc" else CAT_SLOTS[i]))
    over = sum(x[2] for x in seg) - bar_w
    while over > 0:                            # trim the widest to fit exactly
        j = max(range(len(seg)), key=lambda k: seg[k][2])
        seg[j] = (*seg[j][:2], seg[j][2] - 1, seg[j][3]); over -= 1
    for name, v, n, c in seg:
        bar += fg(c) + GUT_BAR * n
    bar = frame(bar + R)

    parts = []
    for name, v, n, c in seg:
        # swatch · label · SPACE · value - the gap keeps "Bash" and "70" from
        # reading as one token ("Bash70")
        parts.append(f"{fg(c)}{GUT_BAR}{R}{LABEL}{name[:4]}{R} {DIM}{v / total * 100:.0f}{R}")
    legend = "  ".join(parts)
    while visible_width(legend) > w and len(parts) > 1:
        parts.pop()
        legend = "  ".join(parts)
    return bar, legend


def col(pct):
    """Meter / percentage colour: a STATE, so it wears status tokens."""
    return fg(ramp(pct)) if PALETTE == "legacy" else status(pct)


def tile(frac):
    """Heat-tile colour: a MAGNITUDE, so it wears the sequential ramp."""
    return fg(ramp(frac * 100)) if PALETTE == "legacy" else seq(frac)


# ----------------------------------------------------------------- charts ---
def bar(pct, w=BAR_W, pace=None):
    """Sub-cell meter. `pace` (0-1) draws a bullet-chart tick at that position."""
    pct = max(0.0, min(100.0, float(pct)))
    units = pct / 100.0 * w
    full = int(units)
    frac = EIGHTHS[int((units - full) * 8)]
    partial = 1 if frac != " " else 0
    cells = ([FULL] * full + ([frac] if partial else []) + [EMPTY] * w)[:w]
    tick = int(min(w - 1, max(0, (pace or 0) * w))) if pace is not None else -1

    out = ""
    for i, ch in enumerate(cells):
        if i == tick:
            out += ("\033[38;5;252m" + TICK_EMPTY) if ch == EMPTY \
                else ("\033[38;5;255m" + TICK_FULL)
        elif ch == EMPTY:
            out += DIM + EMPTY
        else:
            out += col(pct) + ch
    return out + R


def woven(glyphs, labels, cur, w=SERIES_W):
    """Interleave value glyphs with dim axis labels, spread to fill w columns.

    glyphs[i] is an already-coloured 1-char string; labels[i] is its axis tick.
    Cells past `cur` (the future half of a window) get the fainter label.

    Each cell is 2 chars, so a strip with fewer cells than the column is wide
    gets the slack distributed BETWEEN its cells rather than dumped on the left:
    5 cells in 14 columns -> 4 spare, 4 gaps, one space each, exact fit.
    """
    n = len(glyphs)
    if not n:
        return f"{FAINT}{HEAT_OFF * w}{R}"
    spread = max(0, (w - 2 * n) // (n - 1)) if n > 1 else 0
    sep = " " * spread
    out = ""
    for i, g in enumerate(glyphs):
        if i:
            out += sep
        out += g + (FAINT if i > cur else DIM) + labels[i]
    return " " * max(0, w - (2 * n + spread * (n - 1))) + out + R


def spark_cells(vals):
    """Sparkline glyphs for a series that may contain None (no data yet)."""
    known = [v for v in vals if v is not None]
    if not known:
        return [f"{FAINT}{HEAT_OFF}" for _ in vals]
    lo, hi = min(known), max(known)
    rng = (hi - lo) or 1.0
    ink = (lambda v: col(v)) if PALETTE == "legacy" else (lambda v: SPARK_INK)
    return [f"{FAINT}{HEAT_OFF}" if v is None
            else ink(v) + SPARK[min(7, int((v - lo) / rng * 8))] for v in vals]


def heat_cells(buckets, cur):
    """Burn per bucket, as HEIGHT first and colour second.

    A 1-char tile can't carry magnitude in colour alone - at that size a dark
    and a bright step of one hue are indistinguishable. So the glyph height is
    the primary channel and the sequential ramp only reinforces it; the strip
    reads correctly even in monochrome.

    Scale is ABSOLUTE, not normalised to the window's own max: full height = 2x
    an even-pace cell, so half height IS even pace. A quiet window therefore
    shows short bars instead of rescaling a trivial cell up to look alarming.
    """
    deltas, prev = [], 0.0
    for b in buckets:
        if b is None:
            deltas.append(None)
        else:
            deltas.append(max(0.0, b - prev))
            prev = b

    full = 200.0 / max(1, len(buckets))      # 2x the even-pace share of one cell
    cells = []
    for i, d in enumerate(deltas):
        if d is None:
            cells.append((FAINT if i > cur else DIM) + HEAT_OFF)
        else:
            t = max(0.0, min(1.0, d / full))
            cells.append(tile(t) + SPARK[min(len(SPARK) - 1, int(t * len(SPARK)))])
    return cells


def trend(vals):
    if len(vals) < 3:
        return f"{FAINT}{TREND[4]}{R}"
    d = vals[-1] - vals[-3]
    if d > 6:
        return f"{fg((230, 110, 110))}{TREND[0]}{R}"
    if d > 1.5:
        return f"{fg((230, 150, 110))}{TREND[1]}{R}"
    if d < -1.5:
        return f"{fg((110, 200, 120))}{TREND[2]}{R}"
    return f"{DIM}{TREND[3]}{R}"


def powerline(segs):
    """segs: [(text, rgb)] -> one joined, background-filled row."""
    segs = [s for s in segs if s[0]]
    if not segs:
        return ""
    if SAFE:
        return f"{DIM} | {R}".join(f"{fg(c)}{txt}{R}" for txt, c in segs)
    out = ""
    for i, (txt, c) in enumerate(segs):
        nxt = segs[i + 1][1] if i + 1 < len(segs) else None
        out += f"{bg(c)}{INK} {txt} {R}"
        if SEP:
            out += f"{fg(c)}{bg(nxt)}{SEP}{R}" if nxt else f"{fg(c)}{SEP}{R}"
    return out


# ------------------------------------------------------------------ time ----
def elapsed(ms):
    total = int(ms // 1000)
    h, rem = divmod(total, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m:02d}m"
    if m:
        return f"{m}m {s:02d}s"
    return f"{s}s"


def until(epoch, now):
    """Countdown to a window reset. A resets_at in the past means Claude Code
    hasn't refreshed rate_limits since the window rolled - that's stale data,
    not a reset in progress, and saying so stops the row looking frozen."""
    left = int(epoch - now)
    if left <= 0:
        return "stale"
    d, rem = divmod(left, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}d {h:02d}h"
    if h:
        return f"{h}h {m:02d}m"
    return f"{m}m"


# --------------------------------------------------------------- history ----
def load_history(path=HISTORY):
    try:
        with open(path) as fh:
            h = json.load(fh)
        return h if isinstance(h, dict) else {}
    except Exception:
        return {}


def save_history(hist, path=HISTORY):
    tmp = None
    try:
        d = os.path.dirname(path) or "."
        fd, tmp = tempfile.mkstemp(dir=d, prefix=".statusline-hist.")
        with os.fdopen(fd, "w") as fh:
            json.dump(hist, fh, separators=(",", ":"))
        os.replace(tmp, path)          # atomic; concurrent sessions can't tear it
    except Exception:
        if tmp:
            try:
                os.unlink(tmp)
            except Exception:
                pass


def update_history(hist, data, now):
    """Fold this sample in. Keyed by resets_at so a new window starts clean."""
    hist.setdefault("w", {})
    hist.setdefault("s", {})

    limits = data.get("rate_limits") or {}
    for key, span, n in (("five_hour", FIVE_H, H5_CELLS), ("seven_day", SEVEN_D, WK_CELLS)):
        win = limits.get(key)
        if not isinstance(win, dict):
            continue
        pct, resets = win.get("used_percentage"), win.get("resets_at")
        if pct is None or not resets:
            continue
        rec = hist["w"].setdefault(find_window_key(hist, key, resets), {"b": [None] * n})
        buckets = rec["b"]
        if len(buckets) != n:                 # bucket count changed -> restart clean
            buckets = rec["b"] = [None] * n
        idx = int(max(0, min(n - 1, (now - (resets - span)) / span * n)))
        prev = buckets[idx]
        buckets[idx] = float(pct) if prev is None else max(prev, float(pct))

    # context: TIME-indexed (t, pct) pairs so the sparkline has a real x-axis.
    # Sampled on change or at least every 30s, so an idle stretch reads as flat.
    sid = data.get("session_id")
    ctx = (data.get("context_window") or {}).get("used_percentage")
    if sid and ctx is not None:
        rec = hist["s"].setdefault(sid, {"u": now, "t": [], "p": []})
        rec["u"] = now
        if not isinstance(rec.get("t"), list) or len(rec.get("t", [])) != len(rec.get("p", [])):
            rec["t"], rec["p"] = [], []       # migrate old turn-indexed records
        ts, ps = rec["t"], rec["p"]
        if not ts or abs(float(ctx) - ps[-1]) >= 0.5:
            ts.append(now)
            ps.append(round(float(ctx), 1))
        # keep one sample older than the window so idle time carries forward
        cutoff, keep = now - CTX_CELLS * CTX_CELL_S, 0
        for i, t in enumerate(ts):
            if t < cutoff:
                keep = i
            else:
                break
        del ts[:keep], ps[:keep]
        if len(ts) > 64:
            del ts[:-64], ps[:-64]

    # prune: dead windows, stale sessions
    # Keep a window well past its reset: while rate_limits are stale the payload
    # still points at the old resets_at, and dropping it wipes the strip.
    hist["w"] = {
        k: v for k, v in hist["w"].items()
        if k.rsplit(":", 1)[-1].isdigit() and int(k.rsplit(":", 1)[-1]) > now - 6 * 3600
    }
    for k in [k for k, v in hist["s"].items() if now - v.get("u", 0) > 43200]:
        hist["s"].pop(k, None)
    if len(hist["s"]) > 24:
        for k in sorted(hist["s"], key=lambda k: hist["s"][k].get("u", 0))[:-24]:
            hist["s"].pop(k, None)
    return hist


# Concurrent sessions get slightly different resets_at for the SAME window (we
# observed two five_hour keys 5m24s apart). Keying on the exact value fragments
# one window's history across several records, so match within a tolerance.
WINDOW_TOL = 3600


def find_window_key(hist, kind, resets):
    """Existing key for this window, or the canonical new one."""
    exact = f"{kind}:{int(resets)}"
    best, best_d = None, WINDOW_TOL + 1
    for k in (hist.get("w") or {}):
        if not k.startswith(kind + ":"):
            continue
        tail = k.rsplit(":", 1)[-1]
        if not tail.isdigit():
            continue
        d = abs(int(tail) - int(resets))
        if d <= WINDOW_TOL and d < best_d:
            best, best_d = k, d
    return best or exact


def window_buckets(hist, kind, resets, n):
    rec = (hist.get("w") or {}).get(find_window_key(hist, kind, resets)) if resets else None
    b = (rec or {}).get("b") or []
    return (list(b) + [None] * n)[:n]


def ctx_series(rec, now):
    """Resample the stored (t, pct) pairs onto CTX_CELLS fixed time cells."""
    ts, ps = (rec or {}).get("t") or [], (rec or {}).get("p") or []
    out = []
    for i in range(CTX_CELLS):
        end = now - (CTX_CELLS - 1 - i) * CTX_CELL_S
        v = None
        for t, pct in zip(ts, ps):
            if t <= end:
                v = pct                        # carry the last known level forward
            else:
                break
        out.append(v)
    return out


def weekday_labels(resets, now):
    """One lowercase weekday initial per day-cell of the 7-day window."""
    start = (resets - SEVEN_D) if resets else (now - SEVEN_D)
    return [("mtwtfss")[time.localtime(start + i * 86400 + 43200).tm_wday]
            for i in range(WK_CELLS)]


# ------------------------------------------------------------------ rows ----
def row(rail, label, meter, pct_txt, series, trend_glyph, when):
    """One table row. Widths here define the column grid."""
    return (f"{DIM}{rail:<2}{R}{LABEL}{label:<3}{R} {meter} {pct_txt} "
            f"{series} {trend_glyph} {DIM}{when:>7}{R}")


def blank_row(rail, label, when="", labels=None):
    """Empty metric. Axis labels still show so the row explains itself."""
    if labels:
        series = woven([f"{FAINT}{HEAT_OFF}" for _ in labels], labels, -1)
    else:
        series = f"{FAINT}{HEAT_OFF * SERIES_W}{R}"
    return row(rail, label, f"{DIM}{EMPTY * BAR_W}{R}", f"{DIM}{'--':>5}{R}",
               series, " " * len(TREND[0]), when)


def header_row(data):
    name = data.get("session_name")
    if not name:
        cwd = data.get("cwd") or (data.get("workspace") or {}).get("current_dir") or ""
        name = os.path.basename(cwd.rstrip("/")) or (data.get("session_id") or "")[:8] or "session"
    if len(name) > NAME_MAX:
        name = name[: NAME_MAX - 1] + ELLIPSIS

    model = ((data.get("model") or {}).get("display_name") or "").split("(")[0].strip()

    segs = [(name, C_NAME)]
    if model:
        segs.append((model, C_MODEL))
    lvl = (data.get("effort") or {}).get("level")
    if lvl:
        segs.append((lvl, C_EFFORT))
    return powerline(segs)


# tens-of-minutes ago at the start of each ctx cell: 7 = 70min ago ... 1 = 10min
CTX_LABELS = [str(CTX_CELLS - i) for i in range(CTX_CELLS)]
# hours remaining at the start of each 5h cell: 5 4 3 2 1, reset at the right edge
H5_LABELS = [str(H5_CELLS - i) for i in range(H5_CELLS)]


def ctx_row(data, hist, now):
    ms = (data.get("cost") or {}).get("total_duration_ms")
    age = elapsed(ms) if ms else ""
    used = (data.get("context_window") or {}).get("used_percentage")
    if used is None:
        return blank_row("", "ctx", age, CTX_LABELS)
    used = float(used)
    vals = ctx_series((hist.get("s") or {}).get(data.get("session_id")), now)
    series = woven(spark_cells(vals), CTX_LABELS, CTX_CELLS - 1)
    return row("", "ctx", bar(used), f"{col(used)}{used:4.0f}%{R}",
               series, trend([v for v in vals if v is not None]), age)


def quota_row(rail, label, win, hist, key, span, n, now):
    resets = win.get("resets_at") if isinstance(win, dict) else None
    labels = weekday_labels(resets, now) if key == "seven_day" else H5_LABELS
    if not isinstance(win, dict) or win.get("used_percentage") is None:
        return blank_row(rail, label, "", labels)
    pct = float(win["used_percentage"])
    pace, cur = None, n - 1
    if resets:
        pace = max(0.0, min(1.0, 1.0 - (resets - now) / span))
        cur = int(max(0, min(n - 1, pace * n)))
    cells = heat_cells(window_buckets(hist, key, resets, n), cur)
    return row(rail, label, bar(pct, pace=pace), f"{col(pct)}{pct:4.0f}%{R}",
               woven(cells, labels, cur), " " * len(TREND[0]),
               until(resets, now) if resets else "")


# --------------------------------------------------------------- assembly ---
def build_lines(data, now, hist, layout=LAYOUT):
    limits = data.get("rate_limits") or {}
    rows = [
        ctx_row(data, hist, now),
        quota_row(RAIL_TOP, "5h", limits.get("five_hour"), hist,
                  "five_hour", FIVE_H, H5_CELLS, now),
        quota_row(RAIL_BOT, "wk", limits.get("seven_day"), hist,
                  "seven_day", SEVEN_D, WK_CELLS, now),
    ]
    head = header_row(data)
    if SAFE or layout == "stacked" or not head:
        return ([head] if head else []) + rows

    hw = visible_width(head) + (SEP_COLS - 1) * (head.count(SEP) if SEP else 0)
    pad = max(HEADER_W, hw + 2)               # fixed, so the gutter never jitters
    gap = " " * max(1, pad - hw)

    # The gutter: the dead space under the header now carries what is actually
    # burning quota. Every line below row 0 starts with a colour escape, not a
    # literal space - Claude Code's renderer strips leading whitespace, which
    # would silently un-indent these rows and shear the table.
    burn = with_overhead(
        burn_state(data.get("session_id"), data.get("transcript_path"), now), data)
    lines = [head + gap + rows[0]]
    # Each gutter row starts at column 0, flush with the header above it, and
    # begins with a colour escape rather than a space so the renderer's
    # leading-whitespace strip has nothing to take.
    for i, g in enumerate(gutter(burn, pad - 1)):
        lines.append(g + " " * max(1, pad - visible_width(g)) + rows[i + 1])
    return lines


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if not isinstance(data, dict):
        return 0

    now = int(time.time())
    hist = load_history()
    try:
        update_history(hist, data, now)
        save_history(hist)
    except Exception:
        pass

    for line in build_lines(data, now, hist):
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
