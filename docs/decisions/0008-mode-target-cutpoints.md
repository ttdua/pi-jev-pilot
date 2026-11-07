# 0008: Modes are target tables, with cut points from the ledger

**Status:** Accepted, 2026-11-07. Replaces [0003](0003-rubric-per-mode.md).

## Context

ADR 0003 gave each mode its own rubric and expert gate. The [2026-11-07 replay](../evidence/2026-11-07-replay.md) reproduced `budget` and `premium`, but `standard` moved toward `deep`, and the operator could not say what mix a mode should give. Wording is also a blunt control: a change to one rubric moves the mix in ways only a replay shows.

The operator set a target mix per mode in [#39](https://github.com/ttdua/pi-jev-pilot/issues/39). An offline spike on the replay answers showed that a single difficulty score, with cut points taken from recent scores, can hold each target.

## Decision

A mode is a **target table**: the share of tier-routed launches for `fast`, `balanced` and `deep`, and a cap for `expert`.

| Mode | `fast` | `balanced` | `deep` | `expert` cap |
|---|---|---|---|---|
| `budget` | 50% | 40% | 10% | 0% |
| `standard` | 20% | 53% | 25% | ≤ 2% |
| `premium` | 0% | 50% | 45% | ≤ 5% |

Each share is meant to stay within ±10 points over recent tier-routed launches. Expert is a cap, not a quota.

- **One worker rubric** for every mode. The worker request is the same in every mode, and `expert_needed` is no longer asked.
- **Difficulty score:** the expected tier rank over Jev's `tier` probabilities (tier keys only, renormalised), plus `effortRank / 8`. An unanswered effort counts as `high`. Range 0–3.5.
- **Cut points** are recomputed from the latest 200 eligible worker lines in the ledger, pooled across modes, and give each mode's target. With fewer than 100 such lines, a seed computed from the 2026-11-07 replay applies.
- **Order:** `expert`, `risky`, `slot`, `cut`. `expert` needs a score at or above the expert cut **and** effort `xhigh` or `max`. `risky > .7` still gives `deep`, and a slot with probability ≥ .6 still wins over the cut.
- **The main request is unchanged.** It keeps its own `fast`, `balanced` and `deep` wording, so strategy gates do not move when the worker rubric changes.
- **Not tuning under [ADR 0005](0005-bounded-auto-tuning.md).** The targets never change automatically, and nothing is stored: the window lives in memory and is rebuilt from the ledger at session start. Cut points only follow the workload to keep the operator's targets.

## Consequences

- Same request count and latency in every mode, and no extra Jev request. A mode affects workers only.
- A mode now says what mix to expect. `/jev` shows the recent mix beside the target, and `cut points: seed` while the seed applies.
- Editing the worker wording needs a new `RUBRIC_VERSION` and a new seed. Lines from older rubrics are ignored by the window.
- A short session can drift from target, since the target is judged over the window, not per session.
- Without a reviewer slot, review launches count in the mix, so `budget` sends implementation work to cheaper tiers than its table suggests.
- The mix is measured; the quality of each mode is not. `budget` carries the most risk.
