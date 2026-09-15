#!/usr/bin/env python3
"""Diagnose a status line that 'looks wrong'. Run in the REAL terminal."""
import importlib.util
import pathlib, os, re, shutil, sys

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
        ("alt  ▐   ", "▐▐▐▐▐▐▐▐▐▐"), ("arrows   ", "▲▼⇈▬◆●○◔◑◕"), ("ellipsis ", "…………………………")]
for name, g in rows:
    print(f"   {D}{name}{R}|{g}|")
print(f"   {Y}any row whose | sticks out to the right = that glyph is DOUBLE-WIDTH here{R}")
print(f"   {Y}-> that is a terminal ambiguous-width setting, not a missing font{R}")

print(f"\n{L}3. NERD FONT PRESENT?{R}")
print(f"   powerline wedge U+E0B0:  {D}[{R}{D}]{R}   rounded U+E0B4: {D}[{R}{D}]{R}")
print(f"   {D}solid triangle/half-circle = Nerd Font installed. Box/blank/? = not installed.{R}")
print(f"   {G}Either answer is FINE - the current config uses ◥ and needs no font.{R}")

print(f"\n{L}4. THE ACTUAL STATUS LINE{R}")
spec = importlib.util.spec_from_file_location("sl", str(pathlib.Path(__file__).with_name("statusline.py")))
sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)
NOW = 1789400000; SID = "doc"
D_ = {"session_name":"my-project","session_id":SID,"model":{"display_name":"Opus 5 (1M context)"},
      "effort":{"level":"high"},"cost":{"total_duration_ms":3864000},
      "context_window":{"used_percentage":62.4},
      "rate_limits":{"five_hour":{"used_percentage":45.0,"resets_at":NOW+7860},
                     "seven_day":{"used_percentage":28.0,"resets_at":NOW+367200}}}
H = {"w":{f"five_hour:{NOW+7860}":{"b":[2,6,7,21,33,36,37,44,45,None,None,None,None,None]},
          f"seven_day:{NOW+367200}":{"b":[1,3,4,4,9,12,15,19,20,24,28,None,None,None]}},
     "s":{SID:{"u":NOW,"p":[8,11,10,19,24,23,31,38,36,44,51,49,58,62]}}}
for sep, tag in (("◥","◥ current "),("▐","▐ safest  "),("","none     "),("","nerd font")):
    sl.SEP = sep
    print(f"\n   {D}--- SEP = {tag} ---{R}")
    for line in sl.build_lines(D_, NOW, H):
        print("   " + line)
sl.SEP = "◥"
print(f"\n   {G}Whichever block above lines up cleanly is the one to keep.{R}\n")
