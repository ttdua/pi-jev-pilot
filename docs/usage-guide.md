# Usage guide

## Before you install

You need:

- [Pi](https://pi.dev) 1.5.0 or newer.
- A [TypeSafe API key](https://console.typesafe.ai). Jev costs about $0.042 per million input tokens, with free output.
- Optionally the `codex` or `opencode` CLI, for CLI reviews.

### If you use the older port

`naicoi92/pi-jev-pilot` must be removed first: both register `/jev` and act on the same prompts. `naicoi92/pi-subagents` must also go, because it registers the same `subagent` tool as the executor this package ships.

Review your agent files as well. The executor uses `prompt_mode` rather than `systemPromptMode`, ignores fork fields such as `acceptanceRole`, and fork-only tools such as `contact_supervisor` do not exist there.

The package never edits your `settings.json` or agent files, and nothing is imported from the port's `jev-pilot.json` or `jev-pilot/` ledger. Its files are in `jev/`, so they do not collide.

## Install

This package ships its own executor (vendored from `@gotgenes/pi-subagents`), so one install is enough.

```bash
pi install git:github.com/ttdua/pi-jev-pilot@v0.3.0
```

If you installed `@gotgenes/pi-subagents`, uninstall it first. Pi refuses to start when two extensions register the `subagent` tool, so the session fails at startup and names the conflict. `@gotgenes/pi-subagents-worktrees` keeps working. `/jev` reports `duplicate executor` only in the narrower case where this package's Jev extension runs with the original executor but without the vendored one; worker routing and tool assessment stay off until the original is removed.

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
| `Jev · off` | All six decision features are switched off |
| `Jev · premium (local)` | A directory mode is set for this directory. It overrides the global mode in every session started here |
| `no executor` in `/jev` | Worker routing and tool assessment are off |
| `duplicate executor` in `/jev` | Jev's extension runs with the original `@gotgenes/pi-subagents` but without the vendored one. Routing and assessment are off. Uninstall the original |

If several apply, the first in this order wins: config error, no key, off, mode. The line is drawn only when Pi has a UI (interactive or RPC), never in print or JSON mode. `/jev status off` removes it.

After each decided prompt the line shows the level that was set or kept:

```text
Jev · standard · high
Jev · standard · high · delegate
```

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
| **Subagent list** | While subagents run, a list appears below the editor, even while you type. Each row shows the agent's model, thinking level and tool counts (`🔧` callable, `⊘` blocked: tools in the run's total the agent cannot call). With an empty prompt, `↓` or `←` enters it on the first agent, and `Enter` opens that agent's transcript. `↑` still goes to history until the list is active. Turn it off with `/subagents:settings` → `Fleet view` |

## Modes

```text
/jev mode budget           target mix leans to the fast tier, in this directory
/jev mode standard         the default, in this directory
/jev mode premium          target mix leans to the deep tier, with an expert cap, in this directory
/jev mode budget global    the same, for every directory without its own mode
/jev mode clear            remove the directory mode
```

`/jev mode <m>` sets the mode for this directory. It is stored in `<cwd>/.pi/jev-mode.json`, and every new, resumed, forked or reloaded Pi run in this directory uses it. Other directories, and subdirectories without their own file, keep the global mode. `/jev mode <m> global` sets the global mode in `state.json`, which is the saved mode. While a directory mode is set it still wins in its directory, and the report says `directory mode <d> still applies here; global mode is now <m>`. `/jev mode clear` removes the directory mode; with none set it reports `no directory mode set`. `/jev reset` removes it too. While it is set, `/jev` shows `mode: premium (this directory; global standard)`.

> [!WARNING]
> **Breaking change:** `/jev mode <m>` no longer changes every directory. Use `/jev mode <m> global` for the old effect. A mode already in `state.json` stays the global mode.

The file `.pi/jev-mode.json` may show up in `git status`. The package never edits `.gitignore`. A damaged file is ignored, so the global mode applies, and `/jev` lists it as `local mode (malformed)` or `local mode (unreadable)`. `/jev mode <m>` overwrites it. Only the mode has a directory layer; switches, the CLI review default and slots stay global.

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

The CLI review is off by default. Turn it on with `/jev cli-review on`, by choosing a reviewer, or with `review.enabled` in `config.json`.

**A CLI review** runs Codex or OpenCode itself, read-only, using that CLI's own login. Ask for it in words:

```text
have Codex review this change
```

Say `with Codex` or `with OpenCode`, and name a model or effort, to override the default for one request. Per-request values are not checked in advance; a wrong name fails the review with the CLI's own error.

Set a default:

```text
/jev cli-review on
/jev cli-review off
/jev cli-review codex luna high
/jev cli-review opencode
/jev cli-review opencode openai/gpt-6.1-sol high
/jev cli-review codex default
/jev cli-review codex luna default
```

Choosing a reviewer turns the CLI review on. `/jev cli-review off` turns it off and keeps the reviewer choice.

The model takes one of three forms:

| Form | Example | Meaning |
|---|---|---|
| Tier | `luna` | A Codex tier name. The newest model of that tier is used at each run |
| Full id | `gpt-6.1-luna`, `openai/gpt-6.1-sol` | A pinned model. For OpenCode, a bare name such as `gpt-6.1-sol` works when only one provider lists it |
| `default` | `default` | Clears the model, so the CLI uses its own default. `default` for the effort clears the effort |

`/jev cli-review` checks the model and effort against the CLI's own list (`codex debug models`, `opencode models`). An unknown model, an unsupported effort, or a name that two OpenCode providers list is refused, and the message suggests close matches. When the list cannot be read (CLI missing, error or timeout), the value is accepted with a warning that it was not checked. An OpenCode effort needs a model.

The choice and the on/off setting are kept in `state.json`; `config.json` is not changed. `/jev` shows them on a `cli review:` line, such as `cli review: on (codex, model luna, effort high)`, or `cli review: off (codex, CLI defaults)` when nothing is set. `/jev reset` turns the CLI review off (unless `review.enabled` is `true` in config) and clears the reviewer choice. `/jev all on|off` leaves it alone.

A CLI review does not depend on the Jev key or the feature switches, only on its own on/off setting. It runs only when you ask, and it is never offered to subagents. While it is off, the `jev_review` tool is not offered to the model, and a call is refused with `jev_review is off. Turn it on with /jev cli-review on.`. A change applies from the next turn, without a restart.

**Upgrading:** from this version, `jev_review` is off until you turn it on. An existing CLI review default does not turn it on by itself. The `review` feature switch is removed: it never controlled anything. `/jev review on|off` now prints the usage text. A `switches.review` left in `state.json` is ignored and removed at the next change.

## Switches

```text
/jev                     status and session tally
/jev skills off          one feature
/jev all off             the six decision features
/jev reset               switches, mode (global and this directory) and CLI review default back to config defaults; clears the CLI review override, off unless review.enabled is true
```

Features: `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `status`, `verbose`. `/jev all on|off` sets the six decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`) and leaves `status` and `verbose` alone, and does not change the CLI review on/off setting. Switches persist across sessions and apply from the next prompt or launch.

`/jev` ends with the session tally, which starts empty in each new or resumed session:

```text
session:
  prompts 2
  workers 1 (openai/gpt-5-mini 1)
  worker tokens 120
  fallbacks 0
```

`/jev verbose on` adds one log line in the conversation for each decision, and for each correction and routed worker. Log lines show levels, probabilities and timings, never prompt text, and are not sent to the model. Example: `jev · main · low → high · 0.5s · p low 0.05 medium 0.10 high 0.70 xhigh 0.10 max 0.05`.

Any other form prints the usage text.

## Tool assessment

For every worker launch, Jev can block tools the task does not need and grant tools it does. It never touches an agent's declared `tools`, and never adds a tool the agent lists in `disallowed_tools`. Candidates are the tools the worker would have by default (blocked when Jev scores `tool::` at 0.5 or more) and the tools in your main session it would not have (granted when `grant::` reaches `tools.grantAt`, default 0.8, at most 32 candidates, blocks first). By default this only records: the launch's `worker` ledger line carries `toolsScored`, `toolsFlagged` and `toolsGranted`, so you can see what it would have done before enabling it. `/jev tools off` stops it.

Assessment runs at launch, in the main session. With the switch on, each launch with candidates costs one extra Jev request, sent at the same time as the worker request, under one `classifier.timeoutMs` deadline. If Jev fails, the worker keeps its default tools and nothing is recorded.

To apply blocks and grants:

```json
{ "tools": { "mode": "enforce" } }
```

The executor drops a grant outside your session's tools, and a tool the child cannot load; `toolsGranted` counts only what took effect. Blocked and granted tools stay that way on every turn of that worker, including a resumed run. A wrongly blocked tool can leave a worker stuck, and a grant widens what a worker can do, so try it on low-stakes work first.

To keep a tool away from an agent for good, list it in the agent file:

```markdown
---
disallowed_tools: bash, write
---
```

It takes the same forms as `tools` (a list or a comma string), wins over `tools` and over any grant, and is applied by the executor itself.

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
/jev tune on       automatic changes again
```

Other lines you may see:

```text
Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune
Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one
Jev tune since your last session: timeoutMs 1500→1800 (2 changes) · /jev tune
```

The last line appears once at session start, and only when a change was not shown before. Without a UI (print or JSON mode) no line is shown, and the next session with a UI shows it. `/jev tune off` keeps a tuned value until `/jev tune undo` or `/jev tune reset`.

`/jev tune` also lists signals per mode over the latest 200 decisions: errors from `fast` or low-effort workers, corrected main turns, large turns at low effort, and small turns at `high`. They are observed only and never change anything.

Tuning pauses while your config is invalid, or while `tuning.json` or the ledger cannot be read.

Limits: one parameter and one step at a time, at least 40 decisions apart, and it reverts itself if results worsen. It never changes your config file, the risk rule, the effort ceiling, the expert rules or the tool threshold. In the first release it changes only `timeoutMs`. If you edit `timeoutMs` in your config, your value replaces a tuned one. Undo also stops the same raise for 200 decisions.

## All commands

```text
/jev                                         status and session tally
/jev <feature> on|off                        effort, subagents, skills, strategy, tools, expert, status, verbose
/jev all on|off                              the six decision features, not status or verbose
/jev reset                                   switches, mode (global and this directory) and CLI review default back to config defaults; clears the CLI review override, off unless review.enabled is true
/jev mode budget|standard|premium [global]
/jev mode clear                              remove the directory mode
/jev <slot> <provider/model> [when <text>]   add or replace a slot
/jev <slot>                                  show it
/jev remove <slot>                           delete a slot
/jev cli-review on|off                       turn the CLI review on or off
/jev cli-review <codex|opencode> [model|default] [effort|default]   kept in state.json; also turns it on
/jev tune [undo|reset|on|off]               show or change tuning
```

No command calls Jev. An unknown model in a slot command gets the three closest names from Pi's registry, without any network lookup.

## Troubleshooting

| Symptom | Likely cause | Try |
|---|---|---|
| Nothing happens | No key, or malformed config | `/jev` shows which |
| Workers keep their model | Agent file uses `locked`, the launch uses `resume`, a service `spawn()` names its own model, a forked launch has `subagents.forkedLaunch` at its default `untouched`, the launch came from another worker, or there is no executor | `/jev verbose on` |
| A worker has no ledger line | It was still running at a reload or session switch, or it was a `resume` | None; by design |
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
