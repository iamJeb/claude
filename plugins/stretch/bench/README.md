# Benchmark

The bench measures what the plugin's guide buys a reader and checks any change to that guide before it ships. Nothing here is needed to run the plugin. It runs under node 24 or later, which strips the type annotations itself, and needs no bundler. The numbers it produces land in `bench/out/`, which git ignores, so this folder carries no results of its own: run it on your own transcripts and read what it prints.

Three measures run through every part, each taken with the plugin's own parser (`measure.ts`). The skim is a reply with every stretch closed, which is what the reader sees by default. The full text is every stretch open, everything the model wrote. The read text is the skim plus the stretches the reader opened, which the plugin notes on the next prompt.

## Setting up

Run `npm install` in the plugin folder once. That brings in TypeScript and the node type declarations for `npm run typecheck`, which checks `bench/` against `bench/tsconfig.json`; the scripts themselves run on node alone. `npm test` validates the plugin and runs its tests, `tests/bench.test.ts` among them, which holds examples that must fail and pass for every layout rule.

## Measuring real transcripts

`native.ts` reads Claude Code session transcripts, the `.jsonl` files under `~/.claude/projects/<project>/`, and measures every reply written while the guide was in force. It finds the guide by the sentinel comment the plugin writes on its first line, so a reply counts whether or not it holds a stretch, and the reading note on the next prompt says what the reader opened.

```
npm run bench:native -- ~/.claude/projects/<project>
npm run bench:report
```

The first command writes one row per reply, counts only, to `bench/out/native.jsonl`; it takes transcript files or whole project folders, and `--out <file>` names another file. The second turns everything in `bench/out/` into `bench/out/results.md` and `bench/out/results.csv` and prints the summary. It says how many replies were written under the guide, how many of those hold a stretch, and what share of their words the skim is; where reading notes exist, it adds what share the reader opened.

## Replaying replies under the guide

`replay.ts` takes real replies written without the plugin, samples up to twenty per project with a fixed seed, and has the model rewrite each one under the guide, told to keep every fact and add nothing. Each rewrite is measured, and its recall, the share of the original's content words that survive with every stretch open, shows whether the rewrite kept the reply or summarised it. Replies under forty words need no stretches by the guide's own rule and are counted as written. It needs a signed-in `claude` and spends model calls.

```
npm run bench:replay -- --per-project 20 ~/.claude/projects/<project>
npm run bench:coverage -- --per-project 5
npm run bench:report
```

`--words N` rewrites under the guide at another short reply length; the default is the plugin's. `coverage.ts` then asks whether the skim still says the important things. For a few of the replayed replies, a blind reader sees only one version, the skim or the original as a control, and writes down every decision, action and result it was told about; a grader lists the original's must-know points and checks both readers against the same list. The control shows how strict the grader is. Both scripts keep raw text in `bench/out/`, which git ignores; the report prints counts only.

## Checking a guide change

The guide in `hooks/guide.ts` is how the plugin teaches the model to write stretches, so a change to it is tested here first. `ab.ts` has each guide variant answer the same tasks and checks the answers two ways.

The layout rules in `rules.ts` are checks of the guide's sentences that the text alone can decide, using the plugin's own parser: the long form keeps the short form's words, each list item stays visible with a stretch of its own, a link is words rather than a lone full stop, and so on. Each rule names the sentence it checks. Rules call no model and are worked out again whenever a report runs, so fixing a rule rescores every earlier run.

The grades in `grading.ts` come from a model judge, never told which guide wrote what, which checks the skim and the full answer against each task's key. Grades are saved, since each one costs a call, with the judge's verdict on each link beside the count. The judge sees the task's question, when there is one, which resolves references but cannot supply results, and accepts a correct command as a full answer.

```
npm run bench:ab -- tasks --out bench/out/<run> --arm g0 --arm grow [--repeats 2] [--writer opus] [--judge sonnet] [--effort medium] [--words 150]
npm run bench:ab -- tasks-report --out bench/out/<run>
npm run bench:ab -- override --out bench/out/<run> --arm grow --repeat 1 --task cache-options --rule items-stay-visible --holds true --reason "<why the rule is wrong here>"
```

An arm is a variant named in `guides.ts`: `g0` is the plugin's guide, and the others add a sentence to it or replace one, each isolating one instruction. `--words` builds every arm on the guide at that short reply length. The first run freezes its inputs in `<run>/manifest.json`. A second run with the same inputs picks up where the first stopped; one with any other input, a guide, a task, the writer or judge, the word count, the Claude Code version, or what the model is asked, is refused. Failed calls are kept as failures and tried again on the next run; they never count as grades. A lock lets only one run use a folder at a time.

To read the answers before choosing how to grade them, pass `--judge none` to `tasks` or `run`: it writes replies and makes no judge call. `compare` then writes `comparison.html`, with both frozen guides and every input beside its two outputs, shown as first read, fully opened, or as written. Failed generations stay visible, and the page has no scores. It needs a run with exactly two arms. `tasks-report` and `report` refuse such a run, and its folder cannot be graded later, since a different `--judge` is a changed input.

```
npm run bench:ab -- tasks --out bench/out/short-guide --arm g0 --arm shortened --judge none --writer opus --effort xhigh
npm run bench:ab -- compare --out bench/out/short-guide
```

`--tasks <file>` replaces the task list with a JSON array of tasks shaped like those in `tasks.ts`, for reproductions that stay private. `--task <id>`, repeated, runs only the named tasks, in the list's order, and `--limit` applies after it. An unknown id, or an empty, malformed or duplicated task file, is refused before any model call. The manifest freezes the tasks chosen, so changing them needs a new `--out`.

The corpus commands compare guides on real replies instead of invented tasks. `corpus` freezes a seeded sample from the project folders named, `run` has each arm rewrite every reply in it, and `report` prints the comparison: the skim's share of the original, where the added words land around the short form, how many short forms the judge calls labels, and how many of each reply's must-know points a blind reader of the skim still takes away.

```
npm run bench:ab -- corpus --per-project 15 ~/.claude/projects/<project>
npm run bench:ab -- run --out bench/out/<run> --arm g0 --arm grow --repeats 3 --writer opus --judge sonnet
npm run bench:ab -- report --out bench/out/<run>
```

The report shows each rule's own count. Where someone overrode it, the adjudicated count appears next to it, and every override is listed with its reason. An override counts only for the answer text it was made on.

When you find something new about how the model writes stretches, add it here so every later guide gets checked against it. First add tasks to `tasks.ts` that reproduce it, and put a few aside with `heldOut`, so a guide chosen on the others is also seen on tasks it was not chosen on. Then add a rule to `rules.ts`, or a fixture to an existing rule, with examples that must fail and examples that must pass in `tests/bench.test.ts`. Last, add the guide change that should fix it to `guides.ts` as a new variant, and run it against `g0`.

`npm run bench:check` runs the bench end to end with a stand-in for `claude` in `stub/`, without calling a model. The stand-in is named in `STRETCH_BENCH_CLAUDE` and run by node, so the bench never needs a `claude` shim on the path. Its scratch folder goes under `STRETCH_BENCH_SCRATCH` when that is set, else the system's temporary folder.
