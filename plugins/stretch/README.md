# stretch

A Claude Code plugin that keeps replies short and puts the detail one click away.

With stretch installed, Claude writes every reply so it reads complete at its shortest. The extra detail is still there, folded behind a phrase you can click. You open only what you want, and Claude finds out what you read.

![A reply lands short, a click opens a phrase in place, « folds it back](demo.gif)

The status line at the bottom of the recording is [statusline](../../statusline/), the quota meter from this same repo. It is a separate install and stretch does not need it.

## What you get

### Shorter replies

The first read is just the answer. The reasoning, caveats and side notes are one click away instead of in your way.

### Claude knows what you read

Your next message tells Claude which phrases you opened and which you skipped. If something you skipped matters to your next question, Claude says it again.

### A quieter transcript

Finished groups of tool calls fold into a single line. Anything still running or anything that failed stays open.

### Nothing gets lost

Wherever clicking is not possible, every phrase is drawn open and you see the whole reply.

## What to expect

It saves reading time, not tokens. Claude still writes every level of detail up front, so a reply costs about the same as before.

Clicks need Claude Code's fullscreen layout in a terminal, or the Claude desktop app. In VS Code, the phone app, or a terminal that is not fullscreen, every phrase shows open. I use it on Windows 11 with Claude Code 2.1.300.

The instructions that teach Claude the markup arrive with the first message you type, rather than in the system prompt, and again with your first message after a compaction or a `/clear`. That way they load even where an organization manages Claude Code settings. Headless runs (`claude -p`), background task notifications and scheduled prompts never get them, so those replies stay plain.

While a reply is still streaming, a phrase whose closing braces have not arrived yet shows as raw text for a moment. It turns into a clickable phrase as soon as that part of the reply lands.

The `{{short|long}}` markup Claude writes shows as raw text anywhere the plugin is not loaded, for example if you paste a transcript somewhere else. The plugin tells Claude to keep the markup out of files, commit messages, emails and tool input, so it only shows up in chat.

It runs on Claude Code's plugin hook API, which is still early access and changes between releases, so a Claude Code update can break it until I catch up.

## What it looks like

Here is a reply as it first lands. The bracketed phrases are links:

```
The refresh failed because [the gateway credentials expired]. Renew them
in the dataset settings and [rerun the refresh].
```

Click "the gateway credentials expired" and it opens in place:

```
The refresh failed because the service account password rotated on Monday
and the gateway still holds the old one, so every scheduled refresh since
then has failed with a login error «. Renew them in the dataset settings
and [rerun the refresh].
```

Click the `«` and it folds back. Stretches can nest, so an opened phrase can hold more phrases of its own.

A phrase Claude uses as a section label, alone on its own line or ending in a colon, is drawn open from the start, since a link there would hide the section.

## The /stretch command

`/stretch off` turns the markup off, and your next message tells Claude to write plain replies. `/stretch on` turns it back on. The choice is remembered across sessions.

`/stretch open-all` opens every phrase in the latest reply at once, and `/stretch close-all` folds them all back. These work in the fullscreen terminal, and phrases opened this way count as read.

`/stretch` on its own shows whether stretch is on and how to use the command.

## Settings

Two settings show up in `/config`. Short reply length (`shortWords`, 150 by default) is the most words a reply should take with every phrase closed; a value below 10 or above 2000 falls back to 150. Fold finished tool groups (`foldTools`, on by default) can be turned off if you would rather see every tool call as Claude Code draws it.

## Install

In a Claude Code session:

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

The second line switches the terminal to the fullscreen layout. If a session still starts on the main screen (inside tmux, for example), start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.

You can also install it from a shell instead:

```
claude plugin marketplace add iamJeb/claude
claude plugin install stretch@iamjeb-claude
```

Run those in a terminal, not at the Claude Code prompt. Typing `!/plugin ...` there fails, because `!` sends the line to the shell.

## Update

When a new version is out, refresh the marketplace and update the plugin from a shell, then restart Claude Code:

```
claude plugin marketplace update iamjeb-claude
claude plugin update stretch@iamjeb-claude
```

## Remove

```
/plugin uninstall stretch
```
