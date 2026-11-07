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

**What the package decides.** The thinking level for that prompt. It picks a level from Jev's answer, raises risky work to at least `high`, caps the start at `xhigh`, and leaves a current `max` alone ([rules](domain-model.md#maindecision)).

**Measured.** In the report run, Jev chose `low` for 74 of 100 prompts, 15 went to `high` and 6 to `xhigh` ([distribution](evidence/2026-11-08-release.md#main-effort)). Compared with a user who never changes `/thinking` (fixed `low`), 5 of the 43 prompts that had a recorded start level were raised and none was lowered. The other 57 of the 100 sampled prompts had no recorded start level. Noise between two runs was 4 of 100 ([noise](evidence/2026-11-08-release.md#rerun-noise)).

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

**What the package decides.** Where each launch goes. A review brief goes to the slot when Jev's slot probability is at least .6 and no earlier rule (`expert`, `risky`) applies; other launches follow the mode's cut points ([rules](domain-model.md#workerdecision)).

**Measured.** 100 of 100 review briefs went to the slot in the report run, and 5 of 100 non-review briefs did too ([reviewer slot](evidence/2026-11-08-release.md#reviewer-slot)).

## Which rule wins

Two kinds of list follow. In a "first match wins" list, the first rule that applies decides. In an "applied in order" list, every step runs in turn.

**Worker launch** ([rules](domain-model.md#workerdecision))

Guards first. They leave a launch alone, or partly alone:

- `resume`, or a fork with `untouched`: the launch is not changed.
- Agent `locked`: if the model is locked, only thinking is written; if both are locked, the launch is untouched.

Target, first match wins:

1. `expert`
2. `risky`
3. Slot probability ≥ .6
4. Cut points

Then availability: an unusable tier moves down, never to `expert`; an unusable slot moves to `balanced`, then `fast`.

Effort, applied in order:

1. Jev's choice
2. At least `high` on risk
3. Cap `xhigh`
4. Cap `medium` on `fast`
5. Clamp to the model

After a fallback move, effort is `xhigh` on every tier, without the `fast` cap.

To override: lock the model or thinking in the agent file.

**Main prompt** ([rules](domain-model.md#maindecision))

Guards first:

- A manual level change during an outstanding request discards that result.
- `holdProviders` keep the newest level until a compaction or a provider or model switch, without asking Jev.
- A current `max` is left alone.

Then, applied in order:

1. Jev's choice
2. At least `high` on risk
3. Start capped at `xhigh`
4. Clamp to the model

To override: change the level yourself, run `/jev effort off`, or edit `effort.holdProviders` in `config.json`.

**Config value** ([files](configuration.md#files)), first match wins:

1. `tuning.json`
2. `state.json`
3. `config.json`
4. The default

To override: edit `config.json` (your value replaces a tuned one), run `/jev tune undo` or `/jev tune reset` to drop a tuned value, or `/jev tune off` to stop automatic changes.
