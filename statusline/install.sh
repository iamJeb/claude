#!/usr/bin/env bash
# Install (or update) this Claude Code status line on the current machine:
#   curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh | bash
# Re-run the same line any time to pull the latest version. Needs only curl + python3.
set -euo pipefail

RAW="https://raw.githubusercontent.com/iamJeb/claude/main/statusline"
DIR="$HOME/.claude"
MAIN="statusline.py"
HELPERS="statusline-legend.py statusline-preview.py statusline-doctor.py statusline-gallery.py"

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v curl    >/dev/null || { echo "curl is required" >&2; exit 1; }
mkdir -p "$DIR"

for f in $MAIN $HELPERS; do
  dest="$DIR/$f"
  if [ -L "$dest" ]; then
    # Source checkout symlinked in (the machine you edit on) — never overwrite through it.
    echo "~/.claude/$f is a symlink ($(readlink "$dest")); leaving it alone."
    continue
  fi
  tmp="$(mktemp)"
  curl -fsSL "$RAW/$f" -o "$tmp"
  mv "$tmp" "$dest"
  chmod +x "$dest"
  echo "installed ~/.claude/$f"
done

python3 - <<'PY'
import json, os, shutil, tempfile, time
p = os.path.expanduser("~/.claude/settings.json")
# refreshInterval 10: the countdowns tick per minute and the context sparkline
# samples on change, so a slower refresh makes the line look frozen.
want = {"type": "command", "command": "python3 ~/.claude/statusline.py",
        "padding": 0, "refreshInterval": 10}
s = {}
if os.path.exists(p):
    try:
        with open(p) as f:
            s = json.load(f)
        if not isinstance(s, dict):
            raise ValueError("not an object")
    except Exception as e:
        raise SystemExit(f"ERROR: ~/.claude/settings.json is not valid JSON ({e}).\n"
                         f"       Fix or move it and re-run — nothing was changed.")
if s.get("statusLine") == want:
    print("settings.json already points at the status line")
else:
    note = "created ~/.claude/settings.json"
    if os.path.exists(p):
        shutil.copy(p, p + ".bak-statusline-" + time.strftime("%Y%m%d-%H%M%S"))
        note = "updated ~/.claude/settings.json (backup saved next to it)"
    s["statusLine"] = want
    # write atomically so an interrupted install can't leave settings.json half-written
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(p) or ".")
    with os.fdopen(fd, "w") as f:
        json.dump(s, f, indent=2)
        f.write("\n")
    os.replace(tmp, p)
    print(note)
PY

cat <<'EOS'
done — it appears on the next refresh (about 10s).

  how to read it   python3 ~/.claude/statusline-legend.py
  if it looks odd  python3 ~/.claude/statusline-doctor.py

no Nerd Font? set CLAUDE_STATUSLINE_SEP="" for colour-only segments.
EOS
