# Scenarios

What changes for you once the package is installed, with the numbers measured on one operator's sessions.

**Read the numbers with care.** They show routing, not quality: nothing here says a routed model does the work well. They come from one operator over two weeks (100 main prompts, 200 worker briefs, each sent twice). See the [release report](evidence/2026-11-08-release.md).

| Scenario | You no longer | Section |
|---|---|---|
| Thinking level | Change `/thinking` before each prompt | [Your thinking level follows the prompt](#your-thinking-level-follows-the-prompt) |
| Worker models | Pick a model for each worker | [Workers get a model and effort for you](#workers-get-a-model-and-effort-for-you) |
| Reviews | Route reviews by hand | [Reviews go to your reviewer model](#reviews-go-to-your-reviewer-model) |
| Rules | Guess which setting applies | [Which rule wins](#which-rule-wins) |

## Your thinking level follows the prompt

**When it applies.** You send a prompt in the main session.

**What you do.** Nothing. Leave `/thinking` where it is, or change it yourself at any time.

**What the package decides.** The thinking level for that prompt. `low` is the usual answer; risky work gets `high` or `xhigh`.

**Measured.** In the report run, 74 of 100 prompts stayed `low`, 15 went to `high` and 6 to `xhigh` ([distribution](evidence/2026-11-08-release.md#main-effort)). Compared with a user who never changes `/thinking` (fixed `low`), 5 of the 43 prompts that had a recorded start level were raised and none was lowered. The other 57 of the 100 sampled prompts had no recorded start level. Noise between two runs was 4 of 100 ([noise](evidence/2026-11-08-release.md#rerun-noise)).

## Workers get a model and effort for you

**When it applies.** A prompt launches a `subagent` worker.

**What you do.** Choose a mode once: `/jev mode budget|standard|premium`.

**What the package decides.** The model tier and thinking level of each launch, so one command shifts the whole tier mix.

**Measured.** Share of 200 launches per tier, tiers only, report run ([table](evidence/2026-11-08-release.md#worker-tier-mix-by-mode)):

| Mode | `fast` | `balanced` | `deep` | `expert` |
|---|---|---|---|---|
| `budget` | 49% | 40% | 12% | 0% |
| `standard` | 25% | 51% | 23% | 2% |
| `premium` | 0% | 49% | 49% | 3% |

Between two runs, 4.5–8% of tiers-only launches changed tier ([noise](evidence/2026-11-08-release.md#rerun-noise)). A shift smaller than that is not a result.

## Reviews go to your reviewer model

**When it applies.** You configured a `reviewer` slot in `config.json` and a worker brief asks for a review.

**What you do.** Name the model once. See [Configuration](configuration.md#crewslots).

**What the package decides.** Whether a launch is a review. Review launches go to the slot; implementation and scout launches follow the mode.

**Measured.** 100 of 100 review briefs went to the slot in the report run, and 5 of 100 non-review briefs did too ([reviewer slot](evidence/2026-11-08-release.md#reviewer-slot)).

## Which rule wins

When two rules disagree, the first one in the list applies.

**Worker launch** ([rules](domain-model.md#workerdecision)):

1. `resume`, or a fork left `untouched`: the launch is not changed.
2. Agent file `locked`.
3. `expert`.
4. `risky`.
5. Slot probability ≥ .6.
6. Cut points.
7. Availability fallback.

Then the effort: Jev's choice → `high` on risk → cap `xhigh` → cap `medium` on `fast` → clamp.

To override: lock the model or thinking in the agent file.

**Main prompt** ([rules](domain-model.md#maindecision)):

1. A manual level change discards the pending result.
2. `holdProviders` keep the last level.
3. Jev's choice.
4. `high` on risk.
5. Cap `xhigh`.
6. `max` is left alone.

To override: change the level yourself, run `/jev effort off`, or edit `effort.holdProviders` in `config.json`.

**Config value** ([files](configuration.md#files)):

1. `tuning.json`
2. `state.json`
3. `config.json`
4. The default.

To override: run `/jev tune off`, or edit `config.json`. A tuned value only applies while the config value matches its recorded base.
