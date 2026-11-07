# Usage guide

> [!NOTE]
> This guide describes the planned behavior. Nothing is installable yet. See the [roadmap](roadmap.md).

## Before you install

You need:

- [Pi](https://pi.dev) 1.5.0 or newer.
- A [TypeSafe API key](https://console.typesafe.ai). Jev costs about $0.042 per million input tokens, with free output.
- `@gotgenes/pi-subagents` for worker routing. The rest works without it.
- Optionally the `codex` or `opencode` CLI, for CLI reviews.

### If you use the older port

`naicoi92/pi-jev-pilot` must be removed first: both register `/jev` and act on the same prompts. `naicoi92/pi-subagents` must also go, because it registers the same `subagent` tool as `@gotgenes/pi-subagents`.

Review your agent files as well. `@gotgenes/pi-subagents` uses `prompt_mode` rather than `systemPromptMode`, ignores fork fields such as `acceptanceRole`, and fork-only tools such as `contact_supervisor` do not exist there.

The package never edits your `settings.json` or agent files, and nothing is imported from the port's `jev-pilot.json` or `jev-pilot/` ledger. Its files are in `jev/`, so they do not collide.

## Install

```bash
pi install npm:@gotgenes/pi-subagents
```

```bash
pi install git:github.com/ttdua/pi-jev-pilot
```

```bash
export TYPESAFE_API_KEY="…"
```

Create `~/.pi/agent/jev/config.json`:

```json
{
  "tiers": {
    "fast": "claude-code/claude-haiku-5-5",
    "balanced": "claude-code/claude-sonnet-5-5",
    "deep": "claude-code/claude-opus-5-5",
    "expert": "claude-code/claude-fable-5-1"
  }
}
```

All other settings have defaults. See the [configuration reference](configuration.md).

## Check it works

Start Pi and type `/jev`. You should see the status, with the mode and no warnings. The line above the editor shows the base state from WG-06:

| You see | Meaning |
|---|---|
| `Jev · standard` | Working. The word is the current mode |
| `Jev · no key` | `TYPESAFE_API_KEY` (or the variable named in config) is not set in this shell |
| `Jev · config error` | `config.json` is malformed or invalid. `/jev` names the field |
| `Jev · off` | All seven decision features are switched off |
| `no executor` in `/jev` | Worker routing and tool assessment are off |

If several apply, the first in this order wins: config error, no key, off, mode. The line is drawn only when Pi has a UI (interactive or RPC), never in print or JSON mode. `/jev status off` removes it.

After each decided prompt the line shows the level that was set or kept:

```text
Jev · standard · high
Jev · standard · high · delegate
```

A later work group adds the skill.

| You see | Meaning |
|---|---|
| `Jev · standard · high` | Jev chose the level for the last prompt (`high` here) |
| `· delegate` | Advice was attached for the last prompt |
| `Jev · no answer` | Jev timed out or failed. Work continues normally |

If you press Esc before any provider request, the status line also returns to its previous text.

## What changes in your sessions

| Thing | Change |
|---|---|
| **Main model** | Never changes |
| **Thinking level** | Set per prompt. Your manual choice lasts until the next prompt, unless you run `/jev effort off` or set `max` |
| **Worker models** | Chosen per launch, overriding what the main model asked for, unless the agent file locks it |
| **Skills** | At most one attached per prompt, on top of Pi's normal catalog |
| **Advice** | Occasionally attached; the model may ignore it |
| **Wait** | About half a second per prompt, 1.5 s at most |

## Modes

```text
/jev mode budget      target mix leans to the fast tier
/jev mode standard    the default
/jev mode premium     target mix leans to the deep tier, with an expert cap
```

Each mode is a target mix of tier-routed worker launches. Jev scores every launch for difficulty, and cut points recomputed from your recent launches keep the mix near the target ([ADR 0008](decisions/0008-mode-target-cutpoints.md)):

| Mode | `fast` | `balanced` | `deep` | `expert` cap |
|---|---|---|---|---|
| `budget` | 50% | 40% | 10% | 0% |
| `standard` | 20% | 53% | 25% | ≤ 2% |
| `premium` | 0% | 50% | 45% | ≤ 5% |

Each share should stay within ±10 points over recent launches. `expert` is a cap, not a quota, and runs only for very hard work at `xhigh` or `max` effort. The targets never change on their own.

`/jev` shows the recent mix beside the target, for example `mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2`. While fewer than 100 launches are recorded, `cut points: seed` is shown and a built-in starting set is used.

A reviewer slot takes the review launches out of these shares. Without one, reviews count in the mix. These figures show where work is routed, not how well each model does it ([evidence](evidence/2026-11-07-replay.md)).

**`budget` is the riskiest mode**: Haiku writes real code. Watch for more failed workers or rework. A mode affects workers only, not your main session.

## Custom model slots

A slot offers Jev another model, with a description of when to choose it.

```text
/jev reviewer 9router/gpt-6.1-sol when Choose when the task is to review, audit or verify existing work and report findings without changing it. Not for implementing, fixing or researching.
```

```text
/jev reviewer           show it
/jev remove reviewer    delete it
```

- At most 8 slots. Names are lowercase letters, digits and `-`, and cannot be a `/jev` word.
- The model must exist in Pi's registry with credentials.
- `when` is required: say what to choose the slot for and what not. A good one: `Choose when the task is to review existing work and report findings. Not for implementing or fixing.` A bad one: `good model`.
- A new slot needs `when`; replacing a model keeps it.
- Jev picks a slot only at probability .6 or higher.
- Risky work goes to `deep`, even when a slot was chosen.

## Reviews

**Routine reviews** go through a slot like the one above. Any subagent doing review work is routed to it, whichever agent it is.

**A CLI review** runs Codex or OpenCode itself, read-only, using that CLI's own login. Ask for it in words:

```text
have Codex review this change
```

Say `with Codex` or `with OpenCode`, and name a model or effort, to override the default for one request. Per-request values are not checked in advance; a wrong name fails the review with the CLI's own error.

Set a default:

```text
/jev cli-review codex luna high
/jev cli-review opencode
/jev cli-review opencode openai/gpt-6.1-sol high
/jev cli-review codex default
/jev cli-review codex luna default
```

The model takes one of three forms:

| Form | Example | Meaning |
|---|---|---|
| Tier | `luna` | A Codex tier name. The newest model of that tier is used at each run |
| Full id | `gpt-6.1-luna`, `openai/gpt-6.1-sol` | A pinned model. For OpenCode, a bare name such as `gpt-6.1-sol` works when only one provider lists it |
| `default` | `default` | Clears the model, so the CLI uses its own default. `default` for the effort clears the effort |

`/jev cli-review` checks the model and effort against the CLI's own list (`codex debug models`, `opencode models`). An unknown model, an unsupported effort, or a name that two OpenCode providers list is refused, and the message suggests close matches. When the list cannot be read (CLI missing, error or timeout), the value is accepted with a warning that it was not checked. An OpenCode effort needs a model.

The choice is kept in `state.json`; `config.json` is not changed. `/jev` shows it on a `cli review:` line, such as `cli review: codex (model luna, effort high)`, or `CLI defaults` when nothing is set. `/jev reset` clears it.

A CLI review does not need the Jev key and does not depend on the switches. It runs only when you ask, and it is never offered to subagents.

## Switches

```text
/jev                     status and session tally
/jev skills off          one feature
/jev all off             the seven decision features
/jev reset               switches, mode and CLI review default back to config defaults
```

Features: `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`, `status`, `verbose`. `/jev all on|off` sets the seven decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`) and leaves `status` and `verbose` alone. Switches persist across sessions and apply from the next prompt or launch.

`/jev` ends with the session tally, which starts empty in each new or resumed session:

```text
session:
  prompts 2
  workers 1 (openai/gpt-5-mini 1)
  worker tokens 120
  fallbacks 0
```

`/jev verbose on` adds one log line in the conversation for each decision, and for each correction and routed worker. Log lines show levels, probabilities and timings, never prompt text, and are not sent to the model. Example: `jev · main · low → high · 0.5s · p low 0.05 medium 0.10 high 0.70 xhigh 0.10 max 0.05`.

From WG-06 only the forms above exist. Any other form prints the usage text until its work group adds it: `tune` (WG-18).

## Tool assessment

For workers whose agent declares no `tools`, Jev can flag tools the task does not need. By default this only records: the launch's `worker` ledger line carries `toolsScored` and `toolsFlagged`, so you can see what it would have removed before enabling it. `/jev tools off` stops it. In both modes the worker waits for Jev before its first turn, at most `classifier.timeoutMs`; if Jev fails, the worker keeps every tool and nothing is recorded.

To remove flagged tools:

```json
{ "tools": { "mode": "enforce" } }
```

It can remove tools, never add them. A removed tool stays removed on every turn of that worker, including a resumed run. A wrongly removed tool can leave a worker stuck, so try it on low-stakes work first.

## Tuning

Tuning adjusts itself. When it changes something, you see one line:

```text
Jev tune: timeoutMs 1500→1800 · /jev tune undo
```

```text
/jev tune          what changed, and current signals
/jev tune undo     revert the last change
/jev tune reset    back to your settings
/jev tune off      no more automatic changes
```

Limits: one parameter and one step at a time, at least 40 decisions apart, and it reverts itself if results worsen. It never changes your config file, the risk rule, the effort ceiling, the expert rules or the tool threshold. In the first release it changes only `timeoutMs`. If you edit `timeoutMs` in your config, your value replaces a tuned one. Undo also stops the same raise for 200 decisions.

## All commands

```text
/jev                                         status and session tally
/jev <feature> on|off                        effort, subagents, skills, strategy, tools, expert, review, status, verbose
/jev all on|off                              the seven decision features, not status or verbose
/jev reset                                   switches, mode and CLI review default back to config defaults
/jev mode budget|standard|premium
/jev <slot> <provider/model> [when <text>]   add or replace a slot
/jev <slot>                                  show it
/jev remove <slot>                           delete a slot
/jev cli-review <codex|opencode> [model|default] [effort|default]   kept in state.json
/jev tune | /jev tune undo | /jev tune reset | /jev tune off   WG-18
```

Forms without a work-group mark work now. Forms marked with a later work group print the usage text until that group lands.

No command calls Jev. An unknown model in a slot command gets the three closest names from Pi's registry, without any network lookup.

## Troubleshooting

| Symptom | Likely cause | Try |
|---|---|---|
| Nothing happens | No key, or malformed config | `/jev` shows which |
| Workers keep their model | Agent file uses `locked`, the launch uses `resume`, a forked launch has `subagents.forkedLaunch` at its default `untouched`, or there is no executor | `/jev verbose on` |
| Almost nothing uses the fast tier | Few bounded tasks reach subagents, since the main session does its own lookups | Try `/jev mode budget`, or delegate lookups to a read-only agent |
| Worker effort is nearly always `high` | That is how the effort rubric currently reads delegated work | Known; a rubric revision is on the [roadmap](roadmap.md) |
| Expert rarely runs | It needs a top difficulty score and `xhigh` or `max` effort, and is capped at 2% in `standard`, 5% in `premium`, 0% in `budget` | `/jev mode premium` |
| The prompt cache keeps missing | Effort changes on a provider that loses cache | Add it to `effort.holdProviders` |
| Vietnamese prompts seem misjudged | Jev is less accurate outside English | Report through `/jev verbose on` output, without sharing private text |

## Uninstall

```bash
pi remove git:github.com/ttdua/pi-jev-pilot
```

Then delete `~/.pi/agent/jev/` if you no longer want the settings or ledger.
