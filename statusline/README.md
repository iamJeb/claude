# statusline

Two-row status line for [Claude Code](https://claude.com/claude-code):

```
my-project · Opus 5 · high · 1h23m
ctx ████░░░░░░ 42% │ 5h ██████░░░░ 62% (2h13m) │ wk ██░░░░░░░░ 18% (3d4h)
```

Bars fill green up to 50%, yellow to 80%, red beyond, so a nearly full bar reads
green → yellow → red (empty cells render as a solid dark track). The time in parentheses
is when that limit resets; the line refreshes every 30s so countdowns keep moving.

## Install / update on any machine

```sh
curl -fsSL https://raw.githubusercontent.com/iamJeb/iamjeb-public_claude/main/statusline/install.sh | bash
```

Needs only `curl` and `python3` (3.8+). It copies `statusline.py` to `~/.claude/` and sets
`statusLine` in `~/.claude/settings.json` (backing the file up first). Run it again to update.

## Editing

On the main machine `~/.claude/statusline.py` is a symlink into this repo, so edits here
are live immediately. Commit and push, then re-run the install line on other machines.
