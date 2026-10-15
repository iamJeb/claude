# stretch

A Claude Code plugin that keeps replies short and puts the detail one click away.

With stretch installed, Claude writes every reply so it reads complete at its shortest. The extra detail is still there, folded behind a phrase you can click. You open only what you want, and Claude finds out what you read.

![A reply lands short, a click opens a phrase in place, « folds it back](demo.gif)

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

## What you get

Shorter replies by default. The first read is just the answer, and the reasoning, caveats and side notes are one click away instead of in your way.

Claude knows what you read. When you send your next message, the plugin tells Claude which phrases you opened and which you skipped. If something you skipped matters to your next question, Claude says it again instead of assuming you saw it.

A quieter transcript. Finished groups of tool calls fold into a single line. Anything still running or anything that failed stays open, so problems never hide.

Nothing gets lost. Wherever clicking is not possible, every phrase is drawn open and you see the whole reply.

## What to expect

It saves reading time, not tokens. Claude still writes every level of detail up front, so a reply costs about the same as before.

Clicks need Claude Code's fullscreen layout in a terminal, or the Claude desktop app. In VS Code, the phone app, or a terminal that is not fullscreen, every phrase shows open. I use it on Windows 11 with Claude Code 2.1.300.

The `{{short|long}}` markup Claude writes shows as raw text anywhere the plugin is not loaded, for example if you paste a transcript somewhere else. The plugin tells Claude to keep the markup out of files, commit messages, emails and tool input, so it only shows up in chat.

It runs on Claude Code's plugin hook API, which is still early access and changes between releases, so a Claude Code update can break it until I catch up.

If your company manages your Claude Code settings, the part that teaches Claude the markup may not load unless the plugin is allowed in those settings.

## Install

In a Claude Code session:

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

The second line switches the terminal to the fullscreen layout. If a session still starts on the main screen (inside tmux, for example), start Claude Code with `CLAUDE_CODE_NO_FLICKER=1`.

To remove it:

```
/plugin uninstall stretch
```
