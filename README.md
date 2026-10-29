# claude

Portable [Claude Code](https://claude.com/claude-code) setup. Each tool has its own folder, its own README and its own install line.

| Tool | What it is | Install |
|---|---|---|
| [statusline](statusline/) | Quota-aware status line: context / 5h / weekly meters with pace ticks, per-window burn history, and a bar attributing what is filling the context | `curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh \| bash` |
| [stretch](plugins/stretch/) | Plugin: replies short by default, click a phrase or type its letter to open it in place, open or close them all at once, select and copy inside them, restyle them; finished tool groups fold to one line | `/plugin install stretch --marketplace iamJeb/claude` |

## stretch

Replies come back short, and the detail is one click away. See [plugins/stretch](plugins/stretch/).

![A reply lands short, a click opens a phrase in place, a click on the chevron folds it back](plugins/stretch/demo.gif)

<p align="center"><i>&#8593; The status line at the bottom is <a href="statusline/">statusline</a>, the quota meter also in this repo &#8593;</i></p>

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

## statusline

One question: will my quota last the week? Install or update on any machine:

```sh
curl -fsSL https://raw.githubusercontent.com/iamJeb/claude/main/statusline/install.sh | bash
```

On a new machine you can also tell Claude: *"install the statusline from github.com/iamJeb/claude"*. The installer puts the scripts in `~/.claude/`, merges the `statusLine` block into `~/.claude/settings.json` (keeping every other setting and saving a backup), and is safe to re-run to update. Needs `curl` and Python 3.8+ (`python3`, or the `py` launcher on Windows, where the one-liner runs in Git Bash). Claude should run that installer rather than hand-copy the files.

This repo is public. Nothing here should contain keys, hostnames, or client details. MIT licensed, see [LICENSE](LICENSE).
