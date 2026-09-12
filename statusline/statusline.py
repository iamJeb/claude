#!/usr/bin/env python3
"""Two-row Claude Code status line."""
import json, re, sys, time

R = "\033[0m"; DIM = "\033[2m"; B = "\033[1m"
GRN = "\033[38;5;42m"; YEL = "\033[38;5;220m"; RED = "\033[38;5;203m"
CYA = "\033[38;5;110m"; MAG = "\033[38;5;140m"; GRY = "\033[38;5;245m"
TRACK = "\033[38;5;238m"   # unfilled part of a bar
FULL = "█"

def heat_used(p):   # more used = worse
    return GRN if p < 50 else (YEL if p < 80 else RED)

def bar(pct, width=10):
    """Each filled cell takes the color of the level it represents, so a bar
    near full reads green -> yellow -> red; the rest is a solid dark track."""
    pct = max(0, min(100, pct))
    n = int(round(pct / 100 * width))
    if pct > 0:
        n = max(1, n)
    cells = [heat_used((i + 0.5) / width * 100) + FULL for i in range(n)]
    return "".join(cells) + TRACK + FULL * (width - n) + R

def dur(sec):
    sec = int(max(0, sec))
    d, rem = divmod(sec, 86400); h, rem = divmod(rem, 3600); m, s = divmod(rem, 60)
    if d: return f"{d}d{h}h"
    if h: return f"{h}h{m:02d}m"
    if m: return f"{m}m{s:02d}s"
    return f"{s}s"

def main():
    try:
        d = json.load(sys.stdin)
    except Exception:
        print("statusline: bad payload"); return

    # ---- row 1: session · model · effort · uptime ----
    name = d.get("session_name") or d.get("workspace", {}).get("current_dir", "").split("/")[-1] or "session"
    model = re.sub(r"\s*\([^)]*\)\s*$", "", d.get("model", {}).get("display_name", "?")).strip() or "?"
    effort = (d.get("effort") or {}).get("level", "")
    ran = dur((d.get("cost", {}).get("total_duration_ms") or 0) / 1000)
    sep = f" {DIM}·{R} "
    bits = [f"{B}{CYA}{name}{R}", f"{MAG}{model}{R}"]
    if effort: bits.append(f"{GRY}{effort}{R}")
    bits.append(f"{GRY}{ran}{R}")
    row1 = sep.join(bits)

    # ---- row 2: ctx │ 5h │ week ----
    cw = d.get("context_window") or {}
    used = cw.get("used_percentage")
    if used is None:
        size = cw.get("context_window_size") or 0
        tot = cw.get("total_input_tokens") or 0
        used = round(tot / size * 100) if size else 0
    used = round(used)
    seg = [f"{DIM}ctx{R} {bar(used)} {heat_used(used)}{used}%{R}"]

    now = time.time()
    for key, label in (("five_hour", "5h"), ("seven_day", "wk")):
        rl = (d.get("rate_limits") or {}).get(key)
        if not rl:
            continue
        u = round(rl.get("used_percentage") or 0)
        piece = f"{DIM}{label}{R} {bar(u)} {heat_used(u)}{u}%{R}"
        rs = rl.get("resets_at")
        if rs:
            piece += f" {GRY}({dur(rs - now)}){R}"
        seg.append(piece)

    print(row1)
    print(f" {DIM}│{R} ".join(seg))

main()
