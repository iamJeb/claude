# stretch

A Claude Code plugin. Replies come back short, and the detail is one click away.

![A reply lands short, a click opens a phrase in place, a click on the chevron folds it back](demo.gif)

<p align="center"><i>&#8593; The status line at the bottom is <a href="../../statusline/">statusline</a>, the quota meter also in this repo &#8593;</i></p>

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

Needs Claude Code 2.1.275 or later and a fullscreen terminal or the desktop app. Details under [Install](#install).

## How it works

Claude writes each reply so it reads complete at its shortest. Where there is more to say, it folds the extra behind a phrase. That phrase is a stretch. Click it and the detail opens in place. Click « and it folds back.

Your next message tells Claude which stretches you opened. If you skipped one that matters to your next question, Claude says it again.

Finished groups of tool calls fold to one line. Anything still running, or anything that failed, stays open.

A stretch Claude uses as a label, alone on its own line and not written as a sentence, such as a heading word, a question or a phrase ending in a colon, is drawn open from the start.

Wherever clicking is not possible, every stretch is drawn open and you see the whole reply.

Nothing that leaves the chat carries the markup. Claude is told to keep it out of files, commits, pull requests, issues, work item comments, emails, chat messages, prompts for other agents or sessions, commands, API calls and anything printed for you to paste. The plugin also refuses any tool call whose input holds a stretch, and Claude sends the call again written plain. A copy from the screen takes only what is drawn, so a block meant for pasting is written plain inside a code fence.

## Good to know

It saves reading time, not tokens. Claude still writes every level of detail, so a reply costs about what it did before.

Clicks work in Claude Code's fullscreen terminal layout and in the desktop app. In VS Code, the phone app, or a terminal that is not fullscreen, every stretch shows open.

The instructions that teach Claude the markup arrive with your first message, and again after a compaction or `/clear`. That way they load even where an organization manages Claude Code settings. Headless runs (`claude -p`), background task notifications and scheduled prompts never get them, so those replies stay plain.

While a reply is still streaming, a stretch shows as raw `{{short|long}}` text until its closing braces arrive. The same raw text shows anywhere the plugin is not loaded, such as a transcript pasted elsewhere. Claude is told to keep the markup out of files, commit messages, emails and tool input.

The plugin hook API is early access and changes between Claude Code releases, so an update can break stretch until I catch up.

## The /stretch command

`/stretch off` turns the markup off, and your next reply is plain. `/stretch on` turns it back on. The choice is remembered across sessions. Off also lifts the tool call guard, which is how a file that has to contain the markup, such as this plugin's own tests, gets written.

In the fullscreen terminal, `/stretch open-all` opens every stretch in the latest reply, and `/stretch close-all` folds them all back. Stretches opened this way count as read.

`/stretch` on its own shows whether stretch is on and how to use the command.

## Settings

Two settings show up in `/config`. Short reply length (`shortWords`, 150 by default) is the most words a reply should take with every stretch closed; a value below 10 or above 2000 falls back to 150. Fold finished tool groups (`foldTools`, on by default) can be turned off if you would rather see every tool call as Claude Code draws it.

## Install

Needs Claude Code 2.1.275 or later. In a session:

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

The second line switches the terminal to the fullscreen layout. If a session still starts on the main screen (inside tmux, for example), start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.

From a shell instead:

```
claude plugin marketplace add iamJeb/claude
claude plugin install stretch@iamjeb-claude
```

Run those in a terminal, not at the Claude Code prompt. Typing `!/plugin ...` there fails, because `!` sends the line to the shell.

## Update

Refresh the marketplace, update the plugin, then restart Claude Code:

```
claude plugin marketplace update iamjeb-claude
claude plugin update stretch@iamjeb-claude
```

## Remove

```
/plugin uninstall stretch
```

## Changes

0.2.2 on 2026-10-17. The markup is kept inside the chat: the guide now lists every place it must not go, from files and commits to messages for other agents and anything printed for pasting, and the plugin refuses a tool call whose input carries a stretch so Claude resends it plain.

0.2.1 on 2026-10-15. Long forms now carry real depth, and the guide shows the sentence-ending pattern that gives them room.

0.2.0 on 2026-10-15. The guide is sent with the first prompt so it loads on org-managed installs. Added the /stretch command, two /config settings, and label-style stretches drawn open.

0.1.0 on 2026-10-15. First release.

Problems and ideas go to [GitHub issues](https://github.com/iamJeb/claude/issues). MIT licensed, see [LICENSE](../../LICENSE).
