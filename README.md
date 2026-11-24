# pi-jev-pilot

Let [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, decide how [Pi](https://pi.dev) works on each prompt and each subagent: the main session's effort, each worker's model and effort, the one skill a prompt needs, and advice on how to split the work.

## Install

Install the executor first, then Jev. Worker routing needs the executor; without it `/jev` shows `executor: no executor; worker routing is off` and the rest keeps working.

```bash
pi install git:github.com/ttdua/pi-subagents@v0.2.0
pi install git:github.com/ttdua/pi-jev-pilot@v0.8.0
```

Only one executor providing the `subagent` tool may be installed; Pi refuses to start with two. When switching to `@ttdua/pi-subagents`, remove the old executor first (for example `@gotgenes/pi-subagents`, or jev-pilot 0.5.x or older, which bundled one).

Upgrading from 0.5.x: remove the old install, install the executor, then reinstall `pi-jev-pilot@v0.6.0`.

```bash
export TYPESAFE_API_KEY="…"
```

Then create `~/.pi/agent/jev/config.json` with your model tiers. The [configuration reference](docs/configuration.md) lists every setting.

## Check it works

Start Pi and type `/jev`. The status line should read `Jev · standard`, or `Jev · premium (local)` when a directory mode is set. If it does not, see [troubleshooting](docs/usage-guide.md#troubleshooting).

## What changes when you turn it on

Each table lists a feature, what you notice in your sessions while it is on, and the command that turns it off. [Scenarios](docs/scenarios.md) shows when each rule applies and which one wins.

### Main session

| Feature | When it is on | Turn it off |
|---|---|---|
| Effort | Pi sets the thinking level for each prompt. You can still change it yourself; your choice lasts until the next prompt. A current `max` is left alone, and providers in the effort hold below keep their level. | `/jev effort off` |
| Effort hold | For providers listed in `effort.holdProviders` (none by default), the level of the latest decision stays until a compaction or a provider or model switch, and Jev is not asked about effort in between (except to gate strategy advice; that answer never moves the level). | Set `effort.holdProviders` to `[]` in `config.json` |
| Skills | At most one skill is attached to a prompt, on top of Pi's normal catalog. | `/jev skills off` |
| Strategy advice | Advice on how to split the work is occasionally attached to a prompt. The model may ignore it. | `/jev strategy off` |

### Workers

| Feature | When it is on | Turn it off |
|---|---|---|
| Routing by knowledge and effort | Each eligible `subagent` launch gets a model tier chosen from the knowledge the task needs and a thinking level chosen from how much work and care it needs, overriding what the main model asked for. Resumed launches and, by default, forked launches are left alone. An agent file that locks only the model still gets its thinking set; lock both to leave a launch untouched. A turn limit too tight for the brief is raised, never lowered and never added. | `/jev subagents off` |
| Modes | One command shifts the whole tier mix, for this directory or for all of them. | No off switch: `standard` is the default. `/jev mode clear` removes a directory mode; `/jev subagents off` stops routing. |
| Frontier tier | Work that needs the rarest knowledge can run on your `frontier` model, within a small cap per mode. | `/jev frontier off` |
| Subagent list | While subagents run, a list appears below the editor; `↓` or `←` on an empty prompt enters it and `Enter` opens an agent's transcript. | `/subagents:settings` → `Fleet view` |
| Slots | Jev can pick a model you named, such as a `reviewer`, when its description fits the task. | `/jev remove <slot>` |
| Fallback | When the chosen model cannot run, the launch moves to a tier that can. It never falls back to `frontier`. | `/jev subagents off` |

### Visibility and tuning

| Feature | When it is on | Turn it off |
|---|---|---|
| Status line | A line above the editor shows the mode and the level last set. | `/jev status off` |
| Tally | `/jev` ends with a tally of prompts, workers and fallbacks for the session. | None needed; it only reports |
| Verbose log | One log line per decision appears in the conversation. It holds levels and timings, never prompt text. Off by default. | `/jev verbose off` |
| Auto-tuning | In this release the package adjusts only `classifier.timeoutMs`, one step at a time, shows one line when it does, and reverts itself if results worsen. | `/jev tune off` stops further changes and keeps the tuned value; `/jev tune undo` or `reset` drops it |

## What never changes

- Your main model.
- Pi works as if the package were not installed when Jev is down, slow or the key is missing.
- The package's ledger and logs never store prompt text, tool arguments or tool output. A manual replay and your CLI's own history are the documented exceptions; see [privacy](docs/privacy.md).
- Your `settings.json` and agent files are never edited by the package.

## What it costs

- **Wait.** About half a second per prompt. Jev is given 1.5 seconds by default (`classifier.timeoutMs`), after which the prompt goes ahead without it.
- **Jev requests.** TypeSafe bills them, at about $0.042 per million input tokens, with free output.
- **Data sent.** Your prompt and recent context go to TypeSafe; [privacy](docs/privacy.md) lists everything and how to limit it.

## Tiers and effort

A tier picks how much the model knows; effort picks how hard it works. The four tiers, from least to most knowledgeable, are `basic`, `broad`, `deep` and `frontier`, each mapped to a model in `config.json`. A long but familiar task gets a `basic` or `broad` model at high effort; a short task that needs rare expertise gets a `deep` or `frontier` model. Risky work raises effort, never the tier. `/jev frontier off` keeps every launch off the `frontier` tier.

## Modes

One command shifts the whole tier mix, for this directory or for all of them:

```text
/jev mode budget global      more work goes to the basic tier
/jev mode standard global    the default
/jev mode premium global     more work goes to the deep and frontier tiers
/jev mode premium            the same, for this directory only (`/jev mode clear` removes it)
```

## All switches at once

- `/jev all off` turns off the five decision features: effort, subagents, skills, strategy and frontier.
- `/jev reset` puts switches and modes back to your config.

## Documentation

- [Usage guide](docs/usage-guide.md): install, modes, slots, reviews
- [Scenarios](docs/scenarios.md): when each feature acts and which rule wins
- [Configuration](docs/configuration.md): every setting and file
- [Privacy](docs/privacy.md): what is sent and stored
- [Architecture](docs/architecture.md): how the parts fit together
- [Changelog](CHANGELOG.md) and [roadmap](docs/roadmap.md)

## Relationship to other projects

- Adapted from [jev-pilot](https://github.com/Akramovic1/jev-pilot) 0.12.1, a Claude Code plugin. This is a rewrite for Pi, not a fork.
- Replaces, and cannot run beside, [naicoi92/pi-jev-pilot](https://github.com/naicoi92/pi-jev-pilot).
- Works with [`@ttdua/pi-subagents`](https://github.com/ttdua/pi-subagents) as its executor, installed separately ([ADR 0011](docs/decisions/0011-executor-as-installed-package.md)).

Not affiliated with TypeSafe, Anthropic or the Pi project. See [NOTICE.md](NOTICE.md).
