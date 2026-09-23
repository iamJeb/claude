#!/usr/bin/env python3
"""How to read the status line - and what's worth reading."""
import importlib.util
import pathlib, sys

# a Windows console or pipe may default to cp1252, which cannot encode these glyphs
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# The meters, strips and gutter come from the real script, so the legend wears
# the same palette the status line does.
spec = importlib.util.spec_from_file_location("sl", str(pathlib.Path(__file__).with_name("statusline.py")))
sl = importlib.util.module_from_spec(spec); spec.loader.exec_module(sl)

R="\033[0m";D="\033[38;5;243m";F="\033[38;5;238m";L="\033[38;5;245m";T="\033[1;38;5;252m"
G="\033[38;5;71m";Y="\033[38;5;179m";RD="\033[38;5;167m";W="\033[1;38;5;255m"
fg, bg = sl.fg, sl.bg
c = sl.col          # meter / percentage colour
meter = sl.bar      # meter(pct, w=8, pace=None)

# A week whose first sample landed on day 3: days 1-3 share that burn, in grey.
WK = ["t", "w", "t", "f", "s", "s", "m"]
strip = sl.woven(sl.heat_cells([None, None, 21.0, 33.0, 63.0, None, None], 4), WK, 4)

# The bar at its real gutter width; the key a little wider so all four labels fit.
BURN = [("base", 550), ("@general-purpose", 220), ("Bash", 150), ("summary", 80)]
gut_bar = sl.gutter(BURN, 33)[0]
gut_key = sl.gutter(BURN, 40)[1]

print(f"""
{T}THE ONLY THREE THINGS THAT SHOULD CHANGE WHAT YOU DO{R}

{W}1. "Should I /clear before I keep going?"{R}   {D}-> the ctx number{R}
     {L}ctx{R} {meter(22)} {c(22)} 22%{R}   {G}plenty of room{R}
     {L}ctx{R} {meter(78)} {c(78)} 78%{R}   {Y}finish the current task, then clear{R}
     {L}ctx{R} {meter(94)} {c(94)} 94%{R}   {RD}clear now or it auto-compacts mid-thought{R}

{W}2. "Can I start something big right now?"{R}   {D}-> 5h number + countdown{R}
     {D}┌ {R}{L}5h {R} {meter(30)} {c(30)} 30%{R} {D}3h 40m{R}   {G}go{R}
     {D}┌ {R}{L}5h {R} {meter(88)} {c(88)} 88%{R} {D}  40m{R}   {Y}small stuff only, resets in 40m{R}
     {D}┌ {R}{L}5h {R} {meter(99)} {c(99)} 99%{R} {D}3h 10m{R}   {RD}you're done for 3 hours{R}

{W}3. "Am I on track to last the week?"{R}   {D}-> the pace tick, the least obvious bit{R}

   The {W}┃{R}/{D}│{R} inside a bar is where you'd be if you burned the window {W}evenly{R}.

     {D}└ {R}{L}wk {R} {meter(30,pace=.6)} {c(30)} 30%{R}  fill stops {G}LEFT{R} of tick  {G}-> under budget, coast{R}
     {D}└ {R}{L}wk {R} {meter(60,pace=.6)} {c(60)} 60%{R}  fill sits {Y}AT{R} the tick    {Y}-> exactly on pace{R}
     {D}└ {R}{L}wk {R} {meter(85,pace=.6)} {c(85)} 85%{R}  fill runs {RD}PAST{R} the tick  {RD}-> you'll run dry early{R}

   {D}This is the one thing a bare percentage cannot tell you. 70% used means
   "relax" on day 6 and "slow down" on day 1 - the tick encodes which.{R}

{F}{'─'*74}{R}

{T}WORTH A GLANCE, NOT A DECISION{R}

  {strip}   the heat strips. One cell per hour (5h) or day (wk).

   {W}Read the HEIGHT, not the colour.{R}  {D}Colour only reinforces it - at one
   character wide, two steps of one hue are indistinguishable, so height
   carries the value and the strip stays readable in monochrome.{R}

     {sl.tile(1.0)}█{R}{D}  a cell at 2x even pace or more - this is where your quota went{R}
     {sl.tile(0.5)}▅{R}{D}  even pace (about half height; anything shorter is under it){R}
     {sl.tile(0.05)}▁{R}{D}  observed, but you burned almost nothing that hour/day{R}
     {D}▂  grey: burn nobody saw happen - before the first sample in a window,
        while no session was open, or on another device. It only shows up at
        the next sample, so it is spread evenly back across the cells it could
        have fallen in, instead of piling onto one cell as a false spike. The
        height is that average; the strip cannot know which cell it was.{R}
     {D}·  no sample yet{R}

   {D}The scale is absolute, not relative to the window's own peak: a quiet
   week shows short bars rather than rescaling its biggest trivial day up to
   look alarming. Tall bars genuinely mean heavy.{R}
   {D}Grey bars at the start of a window are normal: rate_limits only update
   on an API response, so the stretch before the first one is never watched.{R}

  {bg((110,160,220))}\033[38;2;18;18;22m my-project {R}     the header: which session, model and effort
                   {D}level this window is on. Earns its space when several
                   sessions are open at once.{R}

{T}DECORATION - I'd cut these if you want the space back{R}

  {D}·7·6·5▁4▂3█1{R}     the ctx sparkline. In practice it's flat whenever you're
                   {D}reading, and when it does move the percentage already told
                   you. 14 columns for very little.{R}
  {fg((230,150,110))}▲{R}                the trend arrow. Says the same thing as the sparkline.
  {D}48h 26m{R}          session age. Interesting once, never actionable.

{F}{'─'*74}{R}

{T}THE GUTTER - what is actually burning your weekly quota{R}

  {gut_bar}   {D}one stacked bar, full gutter width{R}
  {gut_key}  {D}share of context RE-READ burden{R}

  {W}Weighted by persistence, not size.{R} {D}Every API call re-reads your whole
  context, so a block added 40 calls ago has been paid for 40 times. Each
  source is scored size x calls-since-it-arrived. Images count at about 1.6K
  tokens each, not their base64 length.{R}

  {W}base{R} {D}is the big one and the least obvious: everything the transcript
  cannot show - system prompt, tool definitions, skills loaded this session,
  CLAUDE.md, memory files, reminders. It is measured, not guessed: the
  session's real input tokens (each API call's usage, counted once per
  message id) minus everything the transcript does show. It is resident from
  turn one, so it carries maximum weight.{R}
  {W}/clear does NOT reduce base.{R} {D}A fresh session pays it again. What reduces
  it is loading fewer/smaller skills and keeping CLAUDE.md + MEMORY.md tight.{R}

  {W}@gen @Exp{R} {D}subagents, by type, cut to 4 characters (@gen = general-purpose,
  @Exp = Explore; your own agent types show the same way). Each runs in its
  own context and bills its own calls, so its real input tokens are summed
  from its own transcript under <session>/subagents/, its own system prompt
  and tools included.{R}
  {W}Agen{R} {D}the Agent tool as seen from THIS context: the prompt sent to a
  subagent and the report it sent back. Both stay resident here and are
  re-read on every later call.{R}
  {W}summ{R} {D}the summary a /compact leaves behind. A /compact freezes the cost of
  everything before it: those sources stop growing, and only the summary and
  what comes after it accrue from there.{R}

  {W}What to do:{R}
    {D}base high{R}   {D}-> a big skill is loaded. Nothing to do mid-session; avoid
                 pulling large skills into sessions you want to run long.{R}
    {D}Bash high{R}   {D}-> BOTH the commands I write and their output count.
                 Ask for narrower commands and less verbose output.{R}
    {D}mine/you{R}    {D}-> long replies / large pastes. Reference files by path.{R}
    {D}@agent high{R} {D}-> subagents did the heavy reading, which keeps it out of
                 this context. Worth it while their reports (Agen) stay short.{R}
    {W}/clear{R}      {D}-> resets everything EXCEPT base.{R}

  {D}Categories are per-session: a session that edits files shows Read/Edit/Write
  instead of Bash. Set CLAUDE_STATUSLINE_BURN=convo to drop `base` and show
  only the part your behaviour controls.{R}

{F}{'─'*74}{R}

{T}THE 3-SECOND READ{R}

  Glance at {W}three numbers{R}, left to right: {c(22)}ctx%{R} {c(60)}5h%{R} {c(30)}wk%{R}.
  If none are in the amber/red zone, {G}ignore the rest{R} - it's all context.
  When one goes amber, {W}that row{R} is the one to actually look at.

  {W}For making the week last{R} {D}- your stated priority - the two that matter are
  the {R}{W}wk pace tick{R}{D} (are you ahead of even burn?) and the {R}{W}gutter bar{R}{D} (what to
  cut). Everything else is detail.{R}
""")
