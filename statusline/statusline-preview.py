#!/usr/bin/env python3
"""Render the real status line against synthetic data. Touches no live history."""
import importlib.util
import pathlib, os, sys, time

# a Windows console or pipe may default to cp1252, which cannot encode these glyphs
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

spec = importlib.util.spec_from_file_location("sl", str(pathlib.Path(__file__).with_name("statusline.py")))
sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)

NOW = 1789400000          # fixed so output is reproducible
SID = "preview-session"

DATA = {
    "session_name": "my-project", "session_id": SID,
    "model": {"display_name": "Opus 5 (1M context)"},
    "effort": {"level": "high"},
    "cost": {"total_duration_ms": 3_864_000},
    "context_window": {"used_percentage": 62.4},
    "rate_limits": {
        "five_hour":  {"used_percentage": 45.0, "resets_at": NOW + 7860},
        "seven_day":  {"used_percentage": 28.0, "resets_at": NOW + 367200},
    },
}

# synthetic history: a 5h window burned hard early then idle; a ramping week
HIST = {
  "w": {
    f"five_hour:{NOW + 7860}": {"b": [30.0, 42.0, 45.0, None, None]},
    f"seven_day:{NOW + 367200}": {"b": [3.0, 11.0, 28.0, None, None, None, None]},
  },
  "s": {SID: {"u": NOW, "t": [NOW - i * 300 for i in range(6, -1, -1)],
              "p": [31.0, 38.0, 36.0, 44.0, 51.0, 58.0, 62.0]}},
}

def block(title, note):
    print(f"\n\033[1;38;5;252m{title}\033[0m  \033[38;5;243m{note}\033[0m")
    print("\033[38;5;238m" + "─" * 64 + "\033[0m")

for layout, note in (("inline", "DEFAULT - header on row 1 beside the ctx row, one table"),
                     ("stacked", "header on its own row, table underneath")):
    block(f"layout = {layout}", note)
    for line in sl.build_lines(DATA, NOW, HIST, layout=layout):
        print(line)

block("separator options", "same layout, different SEP - only the first needs a font")
orig_sep = sl.SEP
for sep, tag in (("\ue0b0", "\ue0b0 default  "), ("◥", "◥ plain    "), ("▐", "▐ plain    "), ("", "none      ")):
    sl.SEP = sep
    print(f"\033[38;5;243m{tag}\033[0m " + sl.header_row(DATA))
sl.SEP = orig_sep

block("degraded states", "must never crash or look broken")
# First sample lands in the cell labelled 3: the 36% burned before anyone was
# watching is spread evenly and drawn grey over 5 4 3, not stacked on cell 3.
LATE = {**DATA, "rate_limits": {**DATA["rate_limits"],
        "five_hour": {"used_percentage": 36.0, "resets_at": NOW + 7860}}}
LATE_HIST = {**HIST, "w": {**HIST["w"], f"five_hour:{NOW + 7860}": {"b": [None, None, 36.0, None, None]}}}

for label, d, h in (
    ("first call - no context, no limits yet", {"session_id": "x", "model": {"display_name": "Opus 5"}}, HIST),
    ("no rename - falls back to cwd", {**DATA, "session_name": None, "cwd": "/home/me/project"}, HIST),
    ("no history file at all", DATA, {}),
    ("first 5h sample 2h in - earlier burn spread grey over 5 4 3", LATE, LATE_HIST),
    ("quota nearly gone", {**DATA, "rate_limits": {
        "five_hour": {"used_percentage": 94.0, "resets_at": NOW + 1200},
        "seven_day": {"used_percentage": 88.0, "resets_at": NOW + 90000}}}, HIST),
):
    print(f"\033[38;5;245m{label}\033[0m")
    for line in sl.build_lines(d, NOW, h):
        print("  " + line)
    print()
