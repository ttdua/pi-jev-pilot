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

Start Pi and type `/jev`. You should see the status, with the mode and no warnings. Send a prompt, and the line above the editor shows the decision:

```text
Jev · standard · low · no skill
```

| You see | Meaning |
|---|---|
| `no key` | `TYPESAFE_API_KEY` is not set in this shell |
| `no executor` in `/jev` | Worker routing and tool assessment are off |
| `Jev · no answer` | Jev timed out or failed. Work continues normally |

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
/jev mode budget      more work on the fast tier
/jev mode standard    the default
/jev mode premium     more work on the deep and expert tiers
```

Measured routing on 45 real briefs, as an estimated share of launches:

| Mode | Haiku | Sonnet | Opus | Fable | Reviewer slot |
|---|---|---|---|---|---|
| `budget` | 18% | 36% | 0% | 0% | 46% |
| `standard` | 4% | 43% | 7% | 0% | 46% |
| `premium` | 0% | 14% | 33% | 7% | 46% |

Your mix will differ. These figures show where Jev routes work, not how well each model does it.

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
- A good `when` says what to choose it for and what not. Without one, the default is read-only bulk work.
- Jev picks a slot only at probability .6 or higher.
- Risky work goes to `deep`, even when a slot was chosen.

## Reviews

**Routine reviews** go through a slot like the one above. Any subagent doing review work is routed to it, whichever agent it is.

**A CLI review** runs Codex or OpenCode itself, read-only, using that CLI's own login. Ask for it in words:

```text
have Codex review this change
```

Set a default:

```text
/jev cli-review codex luna high
/jev cli-review opencode
/jev cli-review codex default
```

The choice is kept in `state.json`; `config.json` is not changed. `default` clears the model or effort.

## Switches

```text
/jev                     status and session tally
/jev skills off          one feature
/jev all off             everything
/jev reset               switches, mode and CLI review default back to config defaults
```

Features: `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`, `status`, `verbose`. Switches persist across sessions and apply from the next prompt or launch.

## Tool assessment

For workers whose agent declares no `tools`, Jev can flag tools the task does not need. By default this only records. See what it would have removed in the ledger before enabling it:

```json
{ "tools": { "mode": "enforce" } }
```

It can remove tools, never add them. A wrongly removed tool can leave a worker stuck, so try it on low-stakes work first.

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

Limits: one parameter and one step at a time, at least 40 decisions apart, and it reverts itself if results worsen. It never changes your config file, the risk rule, the effort ceiling, the expert rules or the tool threshold. In the first release it changes only `timeoutMs`.

## All commands

```text
/jev                                         status and tally
/jev <feature> on|off                        effort, subagents, skills, strategy, tools, expert, review, status, verbose
/jev all on|off
/jev reset                                   switches, mode and CLI review default back to config defaults
/jev mode budget|standard|premium
/jev <slot> <provider/model> [when <text>]   add or replace a slot
/jev <slot>                                  show it
/jev remove <slot>
/jev cli-review <codex|opencode> [model] [effort]   kept in state.json
/jev tune | /jev tune undo | /jev tune reset | /jev tune off
```

No command calls Jev. An unknown model in a slot command gets the three closest names from Pi's registry, without any network lookup.

## Troubleshooting

| Symptom | Likely cause | Try |
|---|---|---|
| Nothing happens | No key, or malformed config | `/jev` shows which |
| Workers keep their model | Agent file uses `locked`, the launch uses `resume` or `inherit_context`, or there is no executor | `/jev verbose on` |
| Almost nothing uses the fast tier | Few bounded tasks reach subagents, since the main session does its own lookups | Try `/jev mode budget`, or delegate lookups to a read-only agent |
| Worker effort is nearly always `high` | That is how the effort rubric currently reads delegated work | Known; a rubric revision is on the [roadmap](roadmap.md) |
| Fable never runs | Its rule is strict outside `premium` | `/jev mode premium` |
| The prompt cache keeps missing | Effort changes on a provider that loses cache | Add it to `effort.holdProviders` |
| Vietnamese prompts seem misjudged | Jev is less accurate outside English | Report through `/jev verbose on` output, without sharing private text |

## Uninstall

```bash
pi remove git:github.com/ttdua/pi-jev-pilot
```

Then delete `~/.pi/agent/jev/` if you no longer want the settings or ledger.
