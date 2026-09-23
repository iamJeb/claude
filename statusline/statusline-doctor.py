#!/usr/bin/env python3
"""Diagnose a status line that 'looks wrong'. Run in the REAL terminal."""
import importlib.util
import pathlib, os, re, shutil, sys

# a Windows console or pipe may default to cp1252, which cannot encode these glyphs
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

D="\033[38;5;243m"; L="\033[1;38;5;252m"; G="\033[38;5;71m"; Y="\033[38;5;179m"; RD="\033[38;5;167m"; R="\033[0m"
cols = shutil.get_terminal_size().columns
print(f"\n{L}1. TERMINAL WIDTH{R}")
print(f"   reported: {D}{cols} columns{R}   (COLUMNS={os.environ.get('COLUMNS','unset')})")
print(f"   {D}the status line needs 73, up to 80 with a full-length title{R}")
print("   " + ("".join(str(i//10 % 10) for i in range(min(cols,90)))))
print("   " + ("".join(str(i % 10) for i in range(min(cols,90)))))
print(f"   {G}^ if those two ruler rows wrap, your pane is narrower than the number shown{R}")

print(f"\n{L}2. GLYPH WIDTH{R}  {D}every closing | must land in the SAME column{R}")
rows = [("digits   ", "0123456789"), ("blocks   ", "██████████"), ("shades   ", "░░░░░░░░░░"),
        ("eighths  ", "▏▎▍▌▋▊▉█▉▊"), ("spark    ", "▁▂▃▄▅▆▇█▇▆"), ("heat ■   ", "■■■■■■■■■■"),
        ("dots ·   ", "··········"), ("box  ┌│  ", "┌└│┃─┤├┬┴┼"), ("sep  ◥   ", "◥◥◥◥◥◥◥◥◥◥"),
        ("wedge \ue0b0  ", "\ue0b0" * 10),
        ("alt  ▐   ", "▐▐▐▐▐▐▐▐▐▐"), ("arrows   ", "▲▼⇈▬◆●○◔◑◕"), ("ellipsis ", "…………………………")]
for name, g in rows:
    print(f"   {D}{name}{R}|{g}|")
print(f"   {Y}any row whose | sticks out to the right = that glyph is DOUBLE-WIDTH here{R}")
print(f"   {Y}-> that is a terminal ambiguous-width setting, not a missing font{R}")

print(f"\n{L}3. NERD FONT PRESENT?{R}")
print(f"   powerline wedge U+E0B0:  {D}[{R}{D}]{R}   rounded U+E0B4: {D}[{R}{D}]{R}")
print(f"   {D}solid triangle/half-circle = Nerd Font installed. Box/blank/? = not installed.{R}")
print(f"   {Y}The default separator is this wedge, so it needs a Nerd Font.{R}")
print(f"   {D}If it shows as a box: install a Nerd Font and select it in the terminal, or add a{R}")
print(f"   {D}symbols-only Nerd Font as a fallback after your usual font (the rest of the look{R}")
print(f"   {D}stays the same), or set CLAUDE_STATUSLINE_SEP=◥, which needs no font.{R}")

print(f"\n{L}4. THE ACTUAL STATUS LINE{R}")
spec = importlib.util.spec_from_file_location("sl", str(pathlib.Path(__file__).with_name("statusline.py")))
sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)
NOW = 1789400000; SID = "doc"
D_ = {"session_name":"my-project","session_id":SID,"model":{"display_name":"Opus 5 (1M context)"},
      "effort":{"level":"high"},"cost":{"total_duration_ms":3864000},
      "context_window":{"used_percentage":62.4},
      "rate_limits":{"five_hour":{"used_percentage":45.0,"resets_at":NOW+7860},
                     "seven_day":{"used_percentage":28.0,"resets_at":NOW+367200}}}
H = {"w": {f"five_hour:{NOW + 7860}": {"b": [30.0, 42.0, 45.0, None, None]},
           f"seven_day:{NOW + 367200}": {"b": [3.0, 11.0, 28.0, None, None, None, None]}},
     "s": {SID: {"u": NOW, "t": [NOW - i * 300 for i in range(6, -1, -1)],
                 "p": [31.0, 38.0, 36.0, 44.0, 51.0, 58.0, 62.0]}}}
orig_sep = sl.SEP
for sep, tag in (("\ue0b0", "\ue0b0 default, needs a Nerd Font"), ("\u25e5", "\u25e5 no font needed"),
                 ("\u2590", "\u2590 safest"), ("", "none, colour only")):
    sl.SEP = sep
    print(f"\n   {D}--- SEP = {tag} ---{R}")
    for line in sl.build_lines(D_, NOW, H):
        print("   " + line)
sl.SEP = orig_sep
print(f"\n   {G}Whichever block above lines up cleanly is the one to keep.{R}\n")
