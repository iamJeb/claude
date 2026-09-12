# claude

Portable [Claude Code](https://claude.com/claude-code) setup, one folder per tool. Each folder
has its own README and, where it applies, an `install.sh` you can pipe straight from GitHub on
any machine.

| Tool | What it is | Install |
|---|---|---|
| [statusline](statusline/) | Two-row status line: session, model, effort, uptime; color-coded context / 5h / weekly usage bars | `curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh \| bash` |

## Setting up a new machine with Claude Code

Tell Claude: *"install the statusline from github.com/iamJeb/claude"*.

Note for Claude: install a tool by running its `install.sh` one-liner from the table above, not by
hand-copying files — the installer puts the script in `~/.claude/`, merges the right `statusLine`
block into `~/.claude/settings.json` (keeping every other setting and saving a backup), and is
safe to re-run to update. Requires `curl` and `python3`.

This repo is public — nothing here should contain keys, hostnames, or client details.
