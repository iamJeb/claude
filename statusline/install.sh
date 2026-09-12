#!/usr/bin/env bash
# Install (or update) this Claude Code status line on the current machine:
#   curl -fsSL https://raw.githubusercontent.com/iamJeb/iamjeb-public_claude/main/statusline/install.sh | bash
# Re-run the same line any time to pull the latest version. Needs only curl + python3.
set -euo pipefail

RAW="https://raw.githubusercontent.com/iamJeb/iamjeb-public_claude/main/statusline"
DEST="$HOME/.claude/statusline.py"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
mkdir -p "$HOME/.claude"

if [ -L "$DEST" ]; then
  # Source checkout symlinked in (the machine you edit on) — never overwrite through it.
  echo "~/.claude/statusline.py is a symlink ($(readlink "$DEST")); leaving it alone."
else
  tmp="$(mktemp)"
  curl -fsSL "$RAW/statusline.py" -o "$tmp"
  mv "$tmp" "$DEST"
  chmod +x "$DEST"
  echo "installed $DEST"
fi

python3 - <<'PY'
import json, os, shutil, time
p = os.path.expanduser("~/.claude/settings.json")
want = {"type": "command", "command": "python3 ~/.claude/statusline.py", "padding": 0, "refreshInterval": 30}
s = {}
if os.path.exists(p):
    with open(p) as f:
        s = json.load(f)
if s.get("statusLine") == want:
    print("settings.json already points at the status line")
else:
    if os.path.exists(p):
        shutil.copy(p, p + ".bak-statusline-" + time.strftime("%Y%m%d-%H%M%S"))
    s["statusLine"] = want
    with open(p, "w") as f:
        json.dump(s, f, indent=2)
        f.write("\n")
    print("updated ~/.claude/settings.json (backup saved next to it)")
PY

echo "done — restart Claude Code (or start a new session) to see it."
