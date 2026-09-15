#!/usr/bin/env python3
"""Gallery of every visual idiom that works in a Claude Code status line.

The status line is just text + ANSI escapes, so every "chart" below is a
Unicode glyph trick. Run it to see what your terminal actually renders:

    python3 statusline-gallery.py
"""
import math

R = "\033[0m"
DIM = "\033[38;5;243m"
LBL = "\033[1;38;5;252m"
SUB = "\033[38;5;245m"

def fg(r, g, b): return f"\033[38;2;{r};{g};{b}m"
def bg(r, g, b): return f"\033[48;2;{r};{g};{b}m"

def ramp(pct):
    """Green -> amber -> red."""
    p = max(0.0, min(1.0, pct / 100))
    if p < 0.5:
        t = p / 0.5
        return (int(90 + 155 * t), int(190 - 20 * t), 90)
    t = (p - 0.5) / 0.5
    return (int(245), int(170 - 110 * t), int(90 - 10 * t))

def col(pct): return fg(*ramp(pct))

W = 10
VAL = 62.0
SERIES = [12, 18, 15, 27, 34, 30, 41, 55, 49, 58, 71, 66, 78, 84, 79, 91]

def head(n, title, note):
    print(f"\n{LBL}{n:>2}. {title}{R}  {DIM}{note}{R}")

def show(*rows):
    for r in rows:
        print("     " + r)

# 1 ---------------------------------------------------------------- block bar
head(1, "Block bar", "what you have now - 1 cell granularity")
for v in (18, 62, 94):
    show(f"{SUB}ctx{R} {col(v)}{'█' * round(v/100*W)}{DIM}{'░' * (W - round(v/100*W))}{R} {col(v)}{v:.0f}%{R}")

# 2 ------------------------------------------------------- sub-cell fine bar
head(2, "Sub-cell bar", "left-block eighths - 8x the resolution, same width")
EIGHTHS = " ▏▎▍▌▋▊▉█"
def fine(pct, w=W):
    units = max(0.0, min(1.0, pct/100)) * w
    full = int(units)
    rem = EIGHTHS[int((units - full) * 8)]
    return f"{col(pct)}{'█'*full}{rem}{DIM}{'░'*(w-full-(1 if rem.strip() else 0))}{R}"
for v in (61.2, 62.5, 63.8):
    show(f"{SUB}ctx{R} {fine(v)} {col(v)}{v:.1f}%{R}")

# 3 ------------------------------------------------------------- shade ramp
head(3, "Shade ramp", "density instead of colour - readable on mono terminals")
def shade(pct, w=W):
    units = max(0.0, min(1.0, pct/100)) * w
    full = int(units)
    part = "░▒▓"[min(2, int((units - full) * 3))] if units - full > 0.08 else ""
    return f"{col(pct)}{'█'*full}{part}{DIM}{'·'*(w-full-len(part))}{R}"
show(f"{SUB}ctx{R} {shade(VAL)} {col(VAL)}{VAL:.0f}%{R}")

# 4 ------------------------------------------------------ background-cell bar
head(4, "Background bar", "no glyphs at all - paint cell backgrounds, solid fill")
def bgbar(pct, w=W):
    filled = round(pct/100*w)
    r, g, b = ramp(pct)
    return f"{bg(r,g,b)}{' '*filled}{bg(48,48,52)}{' '*(w-filled)}{R}"
show(f"{SUB}ctx{R} {bgbar(VAL)} {col(VAL)}{VAL:.0f}%{R}")

# 5 --------------------------------------------------------- gradient fill
head(5, "Gradient bar", "each cell coloured by its own position - shows the danger zone")
def grad(pct, w=W):
    filled = round(pct/100*w)
    out = ""
    for i in range(w):
        cp = (i + 0.5) / w * 100
        out += (fg(*ramp(cp)) + "█") if i < filled else (DIM + "░")
    return out + R
show(f"{SUB}ctx{R} {grad(VAL)} {col(VAL)}{VAL:.0f}%{R}")

# 6 --------------------------------------------------------- segmented pips
head(6, "Segmented pips", "discrete buckets - reads as 'how many left', not 'how full'")
def pips(pct, n=8, on="▮", off="▯"):
    k = round(pct/100*n)
    return f"{col(pct)}{on*k}{DIM}{off*(n-k)}{R}"
show(f"{SUB}ctx{R} {pips(VAL)} {col(VAL)}{VAL:.0f}%{R}")
show(f"{SUB}ctx{R} {pips(VAL, 6, '▰', '▱')} {col(VAL)}{VAL:.0f}%{R}   {DIM}(alt glyphs){R}")
show(f"{SUB}ctx{R} {pips(VAL, 5, '●', '○')} {col(VAL)}{VAL:.0f}%{R}   {DIM}(dot meter){R}")

# 7 ------------------------------------------------------------- sparkline
head(7, "Sparkline", "TIME SERIES - needs a history file, the JSON is point-in-time only")
SPARK = "▁▂▃▄▅▆▇█"
def spark(vals, colour=True):
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1
    out = ""
    for v in vals:
        ch = SPARK[min(7, int((v - lo) / rng * 8))]
        out += (col(v) + ch) if colour else ch
    return out + R
show(f"{SUB}ctx{R} {spark(SERIES)} {col(SERIES[-1])}{SERIES[-1]}%{R} {DIM}last 16 turns{R}")
show(f"{SUB}ctx{R} {DIM}{spark(SERIES, colour=False)}{R} {DIM}(monochrome){R}")

# 8 ---------------------------------------------------------- braille plot
head(8, "Braille line plot", "2x4 dots per cell = 8x the pixels of any other option")
def braille(vals, w=16, h=1):
    px_w, px_h = w * 2, h * 4
    lo, hi = min(vals), max(vals)
    rng = (hi - lo) or 1
    grid = [[0] * px_w for _ in range(px_h)]
    for x in range(px_w):
        idx = x / max(1, px_w - 1) * (len(vals) - 1)
        i0, i1 = int(idx), min(len(vals) - 1, int(idx) + 1)
        v = vals[i0] + (vals[i1] - vals[i0]) * (idx - i0)
        y = px_h - 1 - int((v - lo) / rng * (px_h - 1))
        grid[y][x] = 1
    DOT = {(0,0):0x01,(0,1):0x02,(0,2):0x04,(0,3):0x40,
           (1,0):0x08,(1,1):0x10,(1,2):0x20,(1,3):0x80}
    rows = []
    for cy in range(h):
        line = ""
        for cx in range(w):
            bits = 0
            for (dx, dy), m in DOT.items():
                if grid[cy*4+dy][cx*2+dx]:
                    bits |= m
            line += chr(0x2800 + bits)
        rows.append(line)
    return rows
show(f"{SUB}ctx{R} {col(78)}{braille(SERIES, 16, 1)[0]}{R} {DIM}1 row{R}")
for i, row in enumerate(braille(SERIES, 20, 2)):
    show(f"{SUB}{'ctx' if i==0 else '   '}{R} {col(78)}{row}{R}" + (f" {DIM}2 rows = 8px tall{R}" if i==0 else ""))

# 9 -------------------------------------------------------------- pie gauge
head(9, "Pie / moon gauge", "1 character total - the cheapest visual there is")
PIE = "○◔◑◕●"
MOON = "🌑🌘🌗🌖🌕"
for v in (10, 35, 55, 80, 97):
    show(f"{SUB}ctx{R} {col(v)}{PIE[min(4,int(v/100*5))]}{R} {MOON[min(4,int(v/100*5))]} {col(v)}{v}%{R}")

# 10 ------------------------------------------------------------ dial/needle
head(10, "Needle dial", "position, not fill - good for 'where in the window am I'")
def dial(pct, w=W):
    k = min(w-1, int(pct/100*w))
    return f"{DIM}{'─'*k}{col(pct)}◆{DIM}{'─'*(w-1-k)}{R}"
for v in (18, 62, 94):
    show(f"{SUB}5h{R}  {DIM}├{dial(v)}{DIM}┤{R} {col(v)}{v}%{R}")

# 11 ----------------------------------------------------------- bullet chart
head(11, "Bullet chart", "bar + a target/threshold tick - 'am I ahead of budget?'")
def bullet(pct, target, w=W):
    filled = round(pct/100*w)
    tick = min(w-1, int(target/100*w))
    out = ""
    for i in range(w):
        ch, c = ("█", col(pct)) if i < filled else ("░", DIM)
        if i == tick:
            ch, c = "┃", "\033[38;5;252m"
        out += c + ch
    return out + R
show(f"{SUB}wk{R}  {bullet(62, 75)} {col(62)}62%{R} {DIM}pace 75%{R}")
show(f"{SUB}wk{R}  {bullet(88, 75)} {col(88)}88%{R} {DIM}over pace{R}")

# 12 ----------------------------------------------------------- stacked bar
head(12, "Stacked bar", "compose one bar from several series - e.g. what fills the context")
def stacked(parts, w=W):
    out, used = "", 0
    for frac, (r, g, b) in parts:
        n = round(frac/100*w)
        out += fg(r, g, b) + "█"*n
        used += n
    return out + DIM + "░"*(w-used) + R
show(f"{SUB}ctx{R} {stacked([(28,(110,160,220)),(21,(180,140,220)),(13,(230,180,110))], 14)} "
     f"{fg(110,160,220)}sys 28{R} {fg(180,140,220)}msgs 21{R} {fg(230,180,110)}tools 13{R}")

# 13 -------------------------------------------------------------- heatmap
head(13, "Heat strip", "one cell per bucket, colour = value - fits a whole day in 12 chars")
def heat(vals):
    lo, hi = min(vals), max(vals)
    return "".join(fg(*ramp((v-lo)/((hi-lo) or 1)*100)) + "■" for v in vals) + R
show(f"{SUB}5h{R}  {heat(SERIES[:12])} {DIM}12 x 25min buckets{R}")

# 14 ------------------------------------------------------------ diverging
head(14, "Diverging bar", "signed values around a centre - deltas, drift, over/under")
def diverge(pct, w=8):
    n = min(w, round(abs(pct)/100*w))
    if pct >= 0:
        return f"{DIM}{' '*w}│{fg(110,200,120)}{'█'*n}{DIM}{'·'*(w-n)}{R}"
    return f"{DIM}{'·'*(w-n)}{fg(230,110,110)}{'█'*n}{DIM}│{' '*w}{R}"
for v in (+45, -30, +80):
    show(f"{SUB}Δ{R}   {diverge(v)} {fg(110,200,120) if v>0 else fg(230,110,110)}{v:+d}%{R}")

# 15 ----------------------------------------------------------------- trend
head(15, "Trend markers", "direction + magnitude in 2-3 chars, pairs with any bar")
for arrow, c, txt in (("▲", fg(230,110,110), "+12%/turn"), ("▼", fg(110,200,120), "-4%/turn"),
                      ("▬", DIM, "flat"), ("⇈", fg(230,110,110), "burning fast")):
    show(f"{SUB}ctx{R} {fine(VAL)} {col(VAL)}{VAL:.0f}%{R} {c}{arrow}{R} {DIM}{txt}{R}")

# 16 -------------------------------------------------------------- powerline
head(16, "Powerline segments", "coloured blocks with ▶ joins - needs a Nerd Font for the arrow")
def pl(segs):
    out = ""
    for i, (txt, (r, g, b)) in enumerate(segs):
        nxt = segs[i+1][1] if i+1 < len(segs) else None
        out += f"{bg(r,g,b)}{fg(20,20,24)} {txt} {R}"
        out += f"{fg(r,g,b)}{bg(*nxt)}{R}" if nxt else f"{fg(r,g,b)}{R}"
    return out
show(pl([("my-project", (110,160,220)), ("opus", (180,140,220)), (f"{VAL:.0f}%", ramp(VAL))]))

# 17 -------------------------------------------------------------- capacity
head(17, "Capacity glyphs", "battery / vessel metaphors - instantly legible, low precision")
def battery(pct, w=6):
    k = round(pct/100*w)
    return f"{DIM}[{col(pct)}{'█'*k}{DIM}{' '*(w-k)}]{R}"
show(f"{SUB}5h{R}  {battery(VAL)} {col(VAL)}{VAL:.0f}%{R}")
show(f"{SUB}5h{R}  {col(VAL)}{'▰'*4}{DIM}{'▱'*2}▮{R} {col(VAL)}{VAL:.0f}%{R}")

# 18 ------------------------------------------------------------- histogram
head(18, "Column histogram", "sparkline with gaps - comparing a handful of buckets")
def hist(vals):
    lo, hi = 0, max(vals)
    return " ".join(col(v/hi*100) + SPARK[min(7, int(v/hi*8))] for v in vals) + R
show(f"{SUB}by tool{R} {hist([40, 12, 85, 30, 66, 8])} {DIM}bash read edit web task git{R}")

print(f"\n{DIM}Every one of these is plain text + ANSI. Mix freely; width is the only real budget.{R}\n")
