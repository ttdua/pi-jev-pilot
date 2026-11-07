# pi-jev-pilot

Let [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, decide how [Pi](https://pi.dev) works on each prompt and each subagent: the main session's effort, each worker's model and effort, the one skill a prompt needs, and advice on how to split the work.

> [!IMPORTANT]
> **Status: design phase. There is no code yet.** These documents describe the target behavior. See the [roadmap](docs/roadmap.md) for what is planned and in which order.

## What it does

| On each prompt | On each subagent launch | Always |
|---|---|---|
| Sets the session's thinking level | Picks a model tier or a custom slot | Fails open when Jev is unavailable |
| Attaches at most one skill | Picks the worker's thinking level | Records decisions, never prompt text |
| Advises on delegating or parallel work | Can flag tools the worker does not need | Tunes itself within strict limits |

One command shifts the whole distribution of models:

```text
/jev mode budget      more work goes to the fast tier
/jev mode standard    the default
/jev mode premium     more work goes to the deep and expert tiers
/jev mode premium session    the same, for this session only (`/jev mode session off` clears it)
```

## Documentation

Start at the [documentation index](docs/README.md).

| Read this | To learn |
|---|---|
| [Usage guide](docs/usage-guide.md) | How to install, configure and use it |
| [Architecture](docs/architecture.md) | How the parts fit together |
| [Workflows](docs/workflow.md) | What happens at each moment, step by step |
| [Roadmap](docs/roadmap.md) | The work groups and their order |

## Relationship to other projects

- Adapted from [jev-pilot](https://github.com/Akramovic1/jev-pilot) 0.12.1, a Claude Code plugin. This is a rewrite for Pi, not a fork.
- Replaces, and cannot run beside, [naicoi92/pi-jev-pilot](https://github.com/naicoi92/pi-jev-pilot).
- Runs workers through [`@gotgenes/pi-subagents`](https://www.npmjs.com/package/@gotgenes/pi-subagents).

Not affiliated with TypeSafe, Anthropic or the Pi project. See [NOTICE.md](NOTICE.md).
