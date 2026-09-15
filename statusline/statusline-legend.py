#!/usr/bin/env python3
"""How to read the status line - and what's worth reading."""
R="\033[0m";D="\033[38;5;243m";F="\033[38;5;238m";L="\033[38;5;245m";T="\033[1;38;5;252m"
G="\033[38;5;71m";Y="\033[38;5;179m";RD="\033[38;5;167m";W="\033[1;38;5;255m"
def fg(c):return f"\033[38;2;{c[0]};{c[1]};{c[2]}m"
def bg(c):return f"\033[48;2;{c[0]};{c[1]};{c[2]}m"
def ramp(p):
    p=max(0,min(1,p/100))
    if p<.5:t=p/.5;return(int(90+155*t),int(190-20*t),90)
    t=(p-.5)/.5;return(245,int(170-110*t),int(90-10*t))
def c(p):return fg(ramp(p))
def meter(p,w=8,pace=None):
    u=p/100*w;full=int(u);fr=" ▏▎▍▌▋▊▉"[int((u-full)*8)]
    cells=(["█"]*full+([fr] if fr!=" " else [])+["░"]*w)[:w]
    tk=int(min(w-1,(pace or 0)*w)) if pace is not None else -1
    return "".join(("\033[38;5;255m┃" if ch!="░" else "\033[38;5;252m│") if i==tk
                   else(D+"░" if ch=="░" else c(p)+ch) for i,ch in enumerate(cells))+R

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

  {D}▂s█s▂m▂t█w▂t·f{R}   the heat strips. One cell per hour (5h) or day (wk).

   {W}Read the HEIGHT, not the colour.{R}  {D}Colour only reinforces it - at one
   character wide, two steps of one hue are indistinguishable, so height
   carries the value and the strip stays readable in monochrome.{R}

     {D}█{R}{D}  a cell at 2x even pace or more - this is where your quota went{R}
     {D}▄{R}{D}  exactly even pace (half height IS the break-even mark){R}
     {D}▁{R}{D}  observed, but you burned almost nothing that hour/day{R}
     {D}·{R}{D}  never sampled - rate_limits hadn't refreshed yet, so we were
        still being told about the PREVIOUS window{R}

   {D}The scale is absolute, not relative to the window's own peak: a quiet
   week shows short bars rather than rescaling its biggest trivial day up to
   look alarming. Tall bars genuinely mean heavy.{R}
   {D}Leading dots after a window rolls over are normal: the payload only
   updates on an API response, so the first stretch is always unobserved.{R}

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

  {fg((57,135,229))}▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄{fg((217,89,38))}▄▄▄▄▄{fg((25,158,112))}▄{R}   {D}one stacked bar, full gutter width{R}
  {fg((57,135,229))}▄{R}{L}base{R} {D}78{R}  {fg((217,89,38))}▄{R}{L}Bash{R} {D}17{R}  {fg((25,158,112))}▄{R}{L}mine{R} {D}2{R}    {D}share of context RE-READ burden{R}

  {W}Weighted by persistence, not size.{R} {D}Every turn re-reads your whole context,
  so a block added 40 turns ago has been paid for 40 times. Each source is
  scored size x turns-it-has-persisted.{R}

  {W}base{R} {D}is the big one and the least obvious: system prompt + tool
  definitions + any skill loaded this session + CLAUDE.md + MEMORY.md. It is
  resident from turn one, so it carries maximum weight.{R}
  {W}/clear does NOT reduce base.{R} {D}A fresh session pays it again. What reduces
  it is loading fewer/smaller skills and keeping CLAUDE.md + MEMORY.md tight.{R}

  {W}What to do:{R}
    {D}base high{R}   {D}-> a big skill is loaded. Nothing to do mid-session; avoid
                 pulling large skills into sessions you want to run long.{R}
    {D}Bash high{R}   {D}-> BOTH the commands I write and their output count.
                 Ask for narrower commands and less verbose output.{R}
    {D}mine/you{R}    {D}-> long replies / large pastes. Reference files by path.{R}
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
