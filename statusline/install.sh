#!/usr/bin/env bash
# Install (or update) this Claude Code status line on the current machine:
#   curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh | bash
# Re-run the same line any time to pull the latest version. Needs only curl + Python 3.8+.
set -euo pipefail

RAW="https://raw.githubusercontent.com/iamJeb/claude/main/statusline"
DIR="$HOME/.claude"
MAIN="statusline.py"
HELPERS="statusline-legend.py statusline-preview.py statusline-doctor.py statusline-gallery.py"

# First Python that actually runs. On Windows `python3` and `python` can be
# Microsoft Store stubs that exist on PATH but only print an install hint, so
# `command -v` is not enough: each candidate has to execute.
PY=""
for cand in "python3" "py -3" "python"; do
  if $cand -c "import sys; sys.exit(sys.version_info < (3, 8))" >/dev/null 2>&1; then
    PY="$cand"
    break
  fi
done
[ -n "$PY" ] || { echo "Python 3.8+ is required (tried python3, py -3, python)" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
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

$PY - <<'PY'
import json, os, shutil, sys, tempfile, time
p = os.path.expanduser("~/.claude/settings.json")

def fwd(path):
    # Claude Code runs the command through sh, which eats backslashes, so
    # Windows paths go in with forward slashes (and quotes if they hold a space).
    path = path.replace("\\", "/")
    return f'"{path}"' if " " in path else path

if os.name == "nt":
    launcher = shutil.which("py")
    interp = fwd(launcher) + " -3" if launcher else fwd(sys.executable)
    cmd = interp + " " + fwd(os.path.abspath(os.path.expanduser("~/.claude/statusline.py")))
else:
    cmd = "python3 ~/.claude/statusline.py"
# refreshInterval 30: the line also redraws on every tool call and turn, so the
# timer only keeps the countdowns moving while a session sits idle. On Windows
# every timer tick spawns a bash.exe per session, and a fast tick across several
# sessions can trip the MSYS runtime's startup race (git-for-windows #6368),
# which then kills every new bash on the machine until the shared region resets.
want = {"type": "command", "command": cmd, "padding": 0, "refreshInterval": 30}
s = {}
if os.path.exists(p):
    try:
        # utf-8-sig: a settings.json saved by a Windows editor may carry a BOM
        with open(p, encoding="utf-8-sig") as f:
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
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, p)
    print(note)
print("statusLine command: " + cmd)
PY

cat <<EOS
done — it appears on the next refresh (about 10s).

  how to read it   $PY ~/.claude/statusline-legend.py
  if it looks odd  $PY ~/.claude/statusline-doctor.py

the separator needs a Nerd Font. Without one, set CLAUDE_STATUSLINE_SEP=◥ (no font
needed) or CLAUDE_STATUSLINE_SEP="" for colour-only segments.
EOS
