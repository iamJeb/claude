# stretch

A Claude Code plugin. Replies come back short, and the detail is one click away.

![A reply lands short, a click opens a phrase in place, a click on the chevron folds it back](demo.gif)

<p align="center"><i>&#8593; The status line at the bottom is <a href="../../statusline/">statusline</a>, the quota meter also in this repo &#8593;</i></p>

```
/plugin install stretch --marketplace iamJeb/claude
/tui fullscreen
```

Needs Claude Code 2.1.275 or later and a fullscreen terminal or the desktop app. Details under [Install](#install).

## What you get

- Replies that read complete at their shortest, with the depth folded behind phrases you click.
- Click a phrase to open it in place, click « to fold it back. A » on a phrase means a click goes deeper.
- An open all and close all line under any reply with several stretches, with a count of how many are open.
- Claude is told which stretches you opened, and repeats what you skipped when it matters.
- Finished tool calls fold to one line, with show, show all, fold and fold all beside them.
- Text in a paragraph that holds a stretch can be selected and copied: drag across it, or double-click a word. A ctrl- or alt-click on a web link opens it.
- Stretches open from the keyboard: ctrl+↓ or alt+↓ puts a letter over each closed one, and typing the letter opens it.
- `/stretch style` shows a toolbar that restyles how closed stretches are marked, with bold, italic, underline, strikethrough, dim and a highlight.
- `/stretch off` and `/stretch on`, `/stretch open-all` and `/stretch close-all`, `/stretch words N`.
- Chinese, Japanese, Korean and Thai wrap and grow the way their scripts read.
- Nothing that leaves the chat carries the markup: the plugin refuses a tool call that holds a stretch.
- Four `/config` settings: the short reply length, whether tool groups fold, and the marks and highlight on closed stretches.
- A benchmark under `bench/` measures what the guide buys a reader and checks any change to it before it ships.

## How it works

Claude writes each reply so it reads complete at its shortest. Where there is more to say, it folds the extra behind a phrase. That phrase is a stretch. Click it and the detail opens in place. Click « and it folds back.

Your next message tells Claude which stretches you opened. If you skipped one that matters to your next question, Claude says it again.

In the fullscreen terminal, reply text with two or more stretches between one tool call and the next ends in a line with open all, close all, or both, and a count such as 2 of 5 open. A stretch whose detail holds a further stretch ends in », so you can see that a click goes deeper. Stretches you open all at once count as read.

Finished groups of tool calls fold to one line, with show and show all beside it to unfold that group or every finished group; fold and fold all put them back. Anything still running, or anything that failed, stays open.

A stretch Claude uses as a label, alone on its own line and not written as a sentence, such as a heading word, a question or a phrase ending in a colon, is drawn open from the start.

In the fullscreen terminal the plugin draws each paragraph that holds a stretch itself, so the terminal's own selection does not reach it. Instead, a drag across such a paragraph draws the text it crosses inverse and copies it when the button comes up, and stays within that paragraph. A double-click selects and copies the word under it; a path, a flag or a URL comes out whole, and a full stop after the word stays out. A phrase you can open acts when the button comes up, so a drag that starts on one selects rather than opening. A ctrl- or alt-click on an `http:` or `https:` link opens it in your browser; a `file:` link is left to the terminal.

Stretches also open from the keyboard. ctrl+↓ or alt+↓ puts a letter over each closed stretch in the latest three replies on screen, up to 26, and typing that letter opens it. ctrl+↑ or alt+↑ puts letters over each «, to close. Any other key puts the letters away and is typed as usual, as does sending a prompt or pressing the same chord again. Claude Code binds these chords to scrolling the diff panel's file list, so while that panel is open with a long list they scroll it instead.

Chinese and Japanese wrap between characters and grow a character at a time when a stretch opens, with punctuation never starting a row. Korean wraps at spaces. Thai, Lao, Khmer and Myanmar wrap between words, and their vowel and tone marks take no cell of their own.

Wherever clicking is not possible, every stretch is drawn open and you see the whole reply.

Nothing that leaves the chat carries the markup. Claude is told to keep it out of files, commits, pull requests, issues, work item comments, emails, chat messages, prompts for other agents or sessions, commands, API calls and anything printed for you to paste. The plugin also refuses any tool call whose input holds a stretch, and Claude sends the call again written plain. A copy from the screen takes only what is drawn, so a block meant for pasting is written plain inside a code fence.

## Good to know

It saves reading time, not tokens. Claude still writes every level of detail, so a reply costs about what it did before.

Clicks work in Claude Code's fullscreen terminal layout and in the desktop app. In VS Code, the phone app, or a terminal that is not fullscreen, every stretch shows open.

The instructions that teach Claude the markup arrive with your first message, and again after a compaction or `/clear`. That way they load even where an organization manages Claude Code settings. Headless runs (`claude -p`), background task notifications and scheduled prompts never get them, so those replies stay plain.

While a reply is still streaming, a stretch shows as raw `{{short|long}}` text until its closing braces arrive. The same raw text shows anywhere the plugin is not loaded, such as a transcript pasted elsewhere.

The plugin hook API is early access and changes between Claude Code releases, so an update can break stretch until I catch up.

## The /stretch command

`/stretch off` turns the markup off, and your next reply is plain. `/stretch on` turns it back on. The choice is remembered across sessions. Off also lifts the tool call guard, which is how a file that has to contain the markup, such as this plugin's own tests, gets written.

In the fullscreen terminal, `/stretch open-all` opens every stretch in the latest reply, and `/stretch close-all` folds them all back. Stretches opened this way count as read.

`/stretch words 80` makes 80 the most words a reply should take with every stretch closed, from 10 to 2000, and keeps it across sessions ahead of the `/config` setting. `/stretch words` shows the count in force and where it comes from, and `/stretch words default` goes back to the setting. The change reaches Claude with your next message.

In the fullscreen terminal, `/stretch style` puts a toolbar above the prompt that restyles every reply as you click. The marks are bold, italic, underline, strikethrough and dim. The highlight is one of nine deep colours, or tinted, which puts each closed stretch on the colour its words take once you open it, blended into the background, with the text turned near black or near white so it reads. Under a highlight, dim moves the text toward the highlight. Save keeps the style in the two settings below; close puts the toolbar away and drops a style you tried but did not save. With nothing set, phrases stay underlined.

`/stretch` on its own shows whether stretch is on, the word count, and how to use the command.

## Settings

Four settings show up in `/config`. Short reply length (`shortWords`, 150 by default) is the most words a reply should take with every stretch closed; a value below 10 or above 2000 falls back to 150, and a count set with `/stretch words` takes precedence. Fold finished tool groups (`foldTools`, on by default) can be turned off if you would rather see every tool call as Claude Code draws it. Closed stretch marks (`marks`) is a list from bold, italic, underline, strikethrough and dim; empty keeps the underline, and none takes every mark away. Closed stretch highlight (`highlight`) is a hex colour such as `#264f78`, or the word tinted; empty is none. The toolbar writes the last two for you.

## Benchmark

`bench/` measures what the guide buys a reader, on your own transcripts, and checks a guide change before it ships: a skim is a reply with every stretch closed, the full text is every stretch open, and the read text is the skim plus what you opened. Layout rules check the guide's own sentences against each answer, and a model judge grades two guide variants on the same tasks without knowing which wrote what. Nothing in it is needed to run the plugin. [bench/README.md](bench/README.md) says how to run each part.

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

0.4.0 on 2026-10-29. Text in a paragraph that holds a stretch can be selected and copied by drag or double-click, a code block in such a paragraph included, and a ctrl- or alt-click opens a web link. Stretches open from the keyboard with ctrl+↓ or alt+↓ and close with ctrl+↑ or alt+↑. `/stretch style` restyles closed stretches with marks and a highlight, kept in two new settings. Chinese, Japanese, Korean and Thai wrap and grow by their own rules. A long form that ends in a code block closed on the same line as the stretch no longer swallows the rest of the reply. The guide asks for list items as stretches of their own, so a list stays in view. A benchmark under `bench/` measures the guide on real transcripts and checks a change to it.

0.3.1 on 2026-10-19. The open all, close all, show all and fold all rows are drawn by the plugin itself, so the address behind each click no longer shows beside its words. A drag that starts on one of them no longer counts as a click.

0.3.0 on 2026-10-19. A reply with several stretches now ends in open all and close all links with a count of how many are open, and a stretch that holds another ends in ». Tool groups gained show all and fold all beside the per-group toggle, and `/stretch words N` sets the short reply length from the prompt.

0.2.2 on 2026-10-17. The markup is kept inside the chat: the guide now lists every place it must not go, from files and commits to messages for other agents and anything printed for pasting, and the plugin refuses a tool call whose input carries a stretch so Claude resends it plain.

0.2.1 on 2026-10-15. Long forms now carry real depth, and the guide shows the sentence-ending pattern that gives them room.

0.2.0 on 2026-10-15. The guide is sent with the first prompt so it loads on org-managed installs. Added the /stretch command, two /config settings, and label-style stretches drawn open.

0.1.0 on 2026-10-15. First release.

Problems and ideas go to [GitHub issues](https://github.com/iamJeb/claude/issues). MIT licensed, see [LICENSE](../../LICENSE).
