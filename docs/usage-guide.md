# Usage guide

## Before you install

You need:

- [Pi](https://pi.dev) 1.5.0 or newer.
- A [TypeSafe API key](https://console.typesafe.ai). Jev costs about $0.042 per million input tokens, with free output.

### If you use the older port

`naicoi92/pi-jev-pilot` must be removed first: both register `/jev` and act on the same prompts. `naicoi92/pi-subagents` must also go, because it registers the same `subagent` tool as the executor this package ships.

Review your agent files as well. The executor uses `context: fresh | fork` rather than `systemPromptMode`, ignores fork fields such as `acceptanceRole`, and fork-only tools such as `contact_supervisor` do not exist there.

The package never edits your `settings.json` or agent files, and nothing is imported from the port's `jev-pilot.json` or `jev-pilot/` ledger. Its files are in `jev/`, so they do not collide.

## Install

Worker routing needs the executor, [`@ttdua/pi-subagents`](https://github.com/ttdua/pi-subagents), which is a separate package. Install it first, then Jev.

```bash
pi install git:github.com/ttdua/pi-subagents@v0.1.1
pi install git:github.com/ttdua/pi-jev-pilot@v0.6.0
```

Without the executor, `/jev` shows `executor: no executor; worker routing is off` and everything else keeps working.

Only one executor providing the `subagent` tool may be installed; Pi refuses to start with two. When switching to `@ttdua/pi-subagents`, remove the old executor first (for example `@gotgenes/pi-subagents`, or jev-pilot 0.5.x or older, which bundled one).

**Upgrading from 0.5.x.** Remove the old install of this package, install the executor, then reinstall `pi-jev-pilot@v0.6.0`.

```bash
export TYPESAFE_API_KEY="…"
```

Create `~/.pi/agent/jev/config.json`:

```json
{
  "tiers": {
    "basic": "claude-code/claude-haiku-5-5",
    "broad": "claude-code/claude-sonnet-5-5",
    "deep": "claude-code/claude-opus-5-5",
    "frontier": "claude-code/claude-fable-5-1"
  }
}
```

A tier picks how much the model knows; effort picks how hard it works. Upgrading from a release that used `fast`, `balanced` and `expert`: the next main session start renames them in `config.json` and shows one notification, and `/jev expert on|off` still works for one minor release as `/jev frontier on|off`.

All other settings have defaults. See the [configuration reference](configuration.md).

## Check it works

Start Pi and type `/jev`. You should see the status, with the mode and no warnings. The line above the editor shows the base state from WG-06:

| You see | Meaning |
|---|---|
| `Jev · standard` | Working. The word is the current mode |
| `Jev · no key` | `TYPESAFE_API_KEY` (or the variable named in config) is not set in this shell |
| `Jev · config error` | `config.json` is malformed or invalid. `/jev` names the field |
| `Jev · off` | All five decision features are switched off |
| `Jev · premium (local)` | A directory mode is set for this directory. It overrides the global mode in every session started here |
| `executor: no executor; worker routing is off` in `/jev` | The executor is not installed. Install `@ttdua/pi-subagents` (see [Install](#install)) |
| `executor: <name>; no launch policy, worker routing is off` in `/jev` | Another executor is loaded and offers no launch policy (for example the original `@gotgenes/pi-subagents`, shown as `unknown`). Install `@ttdua/pi-subagents` instead |

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
/jev mode budget           target mix leans to the basic tier, in this directory
/jev mode standard         the default, in this directory
/jev mode premium          target mix leans to the deep tier, with a frontier cap, in this directory
/jev mode budget global    the same, for every directory without its own mode
/jev mode clear            remove the directory mode
```

`/jev mode <m>` sets the mode for this directory. It is stored in `<cwd>/.pi/jev-mode.json`, and every new, resumed, forked or reloaded Pi run in this directory uses it. Other directories, and subdirectories without their own file, keep the global mode. `/jev mode <m> global` sets the global mode in `state.json`, which is the saved mode. While a directory mode is set it still wins in its directory, and the report says `directory mode <d> still applies here; global mode is now <m>`. `/jev mode clear` removes the directory mode; with none set it reports `no directory mode set`. `/jev reset` removes it too. While it is set, `/jev` shows `mode: premium (this directory; global standard)`.

> [!WARNING]
> **Breaking change:** `/jev mode <m>` no longer changes every directory. Use `/jev mode <m> global` for the old effect. A mode already in `state.json` stays the global mode.

The file `.pi/jev-mode.json` may show up in `git status`. The package never edits `.gitignore`. A damaged file is ignored, so the global mode applies, and `/jev` lists it as `local mode (malformed)` or `local mode (unreadable)`. `/jev mode <m>` overwrites it. Only the mode has a directory layer; switches and slots stay global.

Each mode is a target mix of tier-routed worker launches. Jev scores every launch for the knowledge it needs, and cut points recomputed from your recent launches keep the mix near the target ([ADR 0008](decisions/0008-mode-target-cutpoints.md), [ADR 0010](decisions/0010-knowledge-tiers.md)):

| Mode | `basic` | `broad` | `deep` | `frontier` cap |
|---|---|---|---|---|
| `budget` | 50% | 40% | 10% | 0% |
| `standard` | 20% | 53% | 26% | ≤ 1% |
| `premium` | 0% | 50% | 47% | ≤ 3% |

Each share should stay within ±10 points over recent launches. `frontier` is a cap, not a quota, and runs only for work that needs the rarest knowledge; effort is not read. The targets never change on their own.

`/jev` shows the recent mix beside the target, for example `mix (last 200, standard): basic 19% / broad 55% / deep 25% / frontier 1% · target 20/53/26/≤1`. While fewer than 100 launches are recorded, `cut points: seed` is shown and a built-in starting set is used.

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
- Risky work keeps its slot or tier and gets at least `high` effort. Only a launch that reaches the `frontier` cut wins over a slot.
- `frontier` is reserved and cannot name a slot. If an older `config.json` has a slot named `frontier`, it still routes, but slot commands refuse to add, replace or remove slots until you rename it in `config.json` by hand.

## Reviews

**Routine reviews** go through a slot like the one above. Any subagent doing review work is routed to it, whichever agent it is.

## Switches

```text
/jev                     status and session tally
/jev skills off          one feature
/jev all off             the five decision features
/jev reset               switches and mode (global and this directory) back to config defaults
```

Features: `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose`. `/jev all on|off` sets the five decision features (`effort`, `subagents`, `skills`, `strategy`, `frontier`) and leaves `status` and `verbose` alone. Switches persist across sessions and apply from the next prompt or launch.

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

To keep a tool away from an agent for good, list it in the agent file:

```markdown
---
disallowed_tools: bash, write
---
```

It takes the same forms as `tools` (a list or a comma string), wins over `tools` and over any grant from the executor's launch policy, and is applied by the executor itself.

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

`/jev tune` also lists signals per mode over the latest 200 decisions: errors from `basic` (or, in older lines, `fast`) or low-effort workers, corrected main turns, large turns at low effort, and small turns at `high`. They are observed only and never change anything.

Tuning pauses while your config is invalid, or while `tuning.json` or the ledger cannot be read.

Limits: one parameter and one step at a time, at least 40 decisions apart, and it reverts itself if results worsen. It never changes your config file, the risk rule, the effort ceiling or the frontier rule. In the first release it changes only `timeoutMs`. If you edit `timeoutMs` in your config, your value replaces a tuned one. Undo also stops the same raise for 200 decisions.

## All commands

```text
/jev                                         status and session tally
/jev <feature> on|off                        effort, subagents, skills, strategy, frontier, status, verbose
/jev all on|off                              the five decision features, not status or verbose
/jev reset                                   switches and mode (global and this directory) back to config defaults
/jev mode budget|standard|premium [global]
/jev mode clear                              remove the directory mode
/jev <slot> <provider/model> [when <text>]   add or replace a slot
/jev <slot>                                  show it
/jev remove <slot>                           delete a slot
/jev tune [undo|reset|on|off]               show or change tuning
```

No command calls Jev. An unknown model in a slot command gets the three closest names from Pi's registry, without any network lookup.

## Troubleshooting

| Symptom | Likely cause | Try |
|---|---|---|
| Nothing happens | No key, or malformed config | `/jev` shows which |
| Workers keep their model | Agent file uses `locked`, the launch uses `resume`, a service `spawn()` names its own model, a fork launch has `subagents.forkLaunch` at its default `untouched`, the launch came from another worker, or there is no executor | `/jev verbose on` |
| A worker has no ledger line | It was still running at a reload or session switch, or it was a `resume` | None; by design |
| Almost nothing uses the basic tier | Few bounded tasks reach subagents, since the main session does its own lookups | Try `/jev mode budget`, or delegate lookups to a read-only agent |
| Worker effort is nearly always `high` | That is how the effort rubric currently reads delegated work | Known; a rubric revision is on the [roadmap](roadmap.md) |
| Frontier rarely runs | It needs a top knowledge score, and is capped at 1% in `standard`, 3% in `premium`, 0% in `budget` | `/jev mode premium` |
| The prompt cache keeps missing | Effort changes on a provider that loses cache | Add it to `effort.holdProviders` |
| Vietnamese prompts seem misjudged | Jev is less accurate outside English | Report through `/jev verbose on` output, without sharing private text |

## Uninstall

```bash
pi remove git:github.com/ttdua/pi-jev-pilot
```

Then delete `~/.pi/agent/jev/` if you no longer want the settings or ledger.
