# pi-jev-pilot

Let [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, decide how [Pi](https://pi.dev) works on each prompt and each subagent: the main session's effort, each worker's model and effort, the one skill a prompt needs, and advice on how to split the work.

## What changes for you

| Scenario | You no longer | Measured | Details |
|---|---|---|---|
| Thinking level | Change `/thinking` for each prompt | Jev chose `low` for 74% of prompts; vs a fixed `low`, 5 of 43 raised, 0 lowered | [Scenario](docs/scenarios.md#your-thinking-level-follows-the-prompt) |
| Worker models | Pick a model for each worker | With no reviewer slot, `budget` sends 49% of launches to `fast` and `premium` 0% | [Scenario](docs/scenarios.md#workers-get-a-model-and-effort-for-you) |
| Reviews | Route reviews by hand | 100 of 100 review briefs reach your reviewer model in the report run | [Scenario](docs/scenarios.md#reviews-go-to-your-reviewer-model) |
| Rules | Guess which setting applies | Ordered lists, no numbers | [Scenario](docs/scenarios.md#which-rule-wins) |

The numbers show routing, not quality, from one operator's sessions. See the [release report](docs/evidence/2026-11-08-release.md).

One command shifts the whole tier mix:

```text
/jev mode budget      more work goes to the fast tier
/jev mode standard    the default
/jev mode premium     more work goes to the deep and expert tiers
```

## Install

```bash
pi install npm:@gotgenes/pi-subagents
```

```bash
pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0
```

```bash
export TYPESAFE_API_KEY="…"
```

Then create `~/.pi/agent/jev/config.json` with your model tiers. The [configuration reference](docs/configuration.md) lists every setting.

## Check it works

Start Pi and type `/jev`. The status line should read `Jev · standard`. If it does not, see [troubleshooting](docs/usage-guide.md#troubleshooting).

## Documentation

- [Usage guide](docs/usage-guide.md): install, modes, slots, reviews
- [Scenarios](docs/scenarios.md): what changes for you, with numbers
- [Configuration](docs/configuration.md): every setting and file
- [Architecture](docs/architecture.md): how the parts fit together
- [Changelog](CHANGELOG.md) and [roadmap](docs/roadmap.md)

## Relationship to other projects

- Adapted from [jev-pilot](https://github.com/Akramovic1/jev-pilot) 0.12.1, a Claude Code plugin. This is a rewrite for Pi, not a fork.
- Replaces, and cannot run beside, [naicoi92/pi-jev-pilot](https://github.com/naicoi92/pi-jev-pilot).
- Runs workers through [`@gotgenes/pi-subagents`](https://www.npmjs.com/package/@gotgenes/pi-subagents).

Not affiliated with TypeSafe, Anthropic or the Pi project. See [NOTICE.md](NOTICE.md).
