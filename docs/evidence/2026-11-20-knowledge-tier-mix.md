# Evidence: knowledge-tier mix by mode, 2026-11-20

This is the seed replay of the `tier-knowledge-axis` change: rubric version 3, the knowledge tiers `basic`, `broad`, `deep` and `frontier`, a difficulty score without effort, and cut points from a rolling window. It replaces the seed published in the [2026-11-07 tier-mix replay](2026-11-07-tier-mix.md), which used rubric version 2. The figures are aggregates from one operator's data. Briefs, answers and scripts are not in this repository.

**Read with care:** these results measure where Jev routes work, not whether the routed model does it well. One operator's workload over two weeks is a small sample, and 281 of the 1101 sampled briefs (about a quarter) were left out (see [Data](#data)).

## Data

| Item | Value |
|---|---|
| Source | Worker launches in session files dated 2026-10-25 to 2026-11-07, the window of the [2026-11-07 replay](2026-11-07-replay.md#data): 170 session files |
| Briefs | 1101 sampled; 281 excluded because the launching agent is unknown in the capabilities snapshot; 820 scored per run |
| Request | Replay report pass (`--pass report`, `--main 0`) with the package's worker state and questions, a capabilities snapshot of 26 tools and 16 agents, all four tiers offered, `frontier` on and one `reviewer` slot. The request is the same in every mode, so each brief is asked once per run |
| Model | Requested `typesafe/jev-1.14` through OpenRouter; the response reports `typesafe/jev-1.14-20261014` |
| Rubric | Version 3 |
| Requests | 1640: a run and a plain rerun of 820 each. No misses |
| Discarded run | A first run on 2026-11-19 with `jev-1.13-free` was rate-limited (HTTP 429): 529 of 820 misses in the run and 820 of 820 in the rerun. It is not used |
| Routing | Offline, per mode, in launch order. Each launch is decided over the window of the launches before it; the first 100 launches of a stream use the run's own seed candidate |

**Limitation:** replay requests carry no display-name prefix on the tier options, since the replay CLI does not wire `--models`. The package sends display names when the operator's registry has them, so the live request can differ slightly from the replayed one.

## Seed cut points

The shipped seed (`SEED_CUTPOINTS`), the report run's seed candidate per mode, computed with the cut-point rules. A score at or below `basicMax` routes to `basic`, at or below `broadMax` to `broad`, and above it to `deep`. `frontier` needs a score of at least `frontierMin`; effort is not read.

| mode | basicMax | broadMax | frontierMin |
|---|---|---|---|
| `budget` | 1.36 | 1.868 | +∞ |
| `standard` | 1.045 | 1.636 | 2.055 |
| `premium` | −∞ | 1.36 | 1.984 |

The rerun's candidates differ by at most 0.005 from these.

## Mix by mode

These are final tier shares after `decideTier`, as a share of the launches routed by cut points, rounded to one decimal. A share is **in range** within ±10 points of its target. For `frontier`, in range means at most the cap plus 10 points. Targets are `basic` / `broad` / `deep` / `frontier` cap.

Two scopes:
- **No slot:** all 820 launches are routed by cut points and all of them feed the window.
- **Reviewer slot:** the `reviewer` slot takes the reviews (396 launches in the run, 398 in the rerun); slot launches never enter the window. Shares are over the remaining 424 (run) and 422 (rerun) launches.

### No slot (n = 820)

| Mode | Run | `basic` | `broad` | `deep` | `frontier` | Target | In range |
|---|---|---|---|---|---|---|---|
| `budget` | run | 49.3% | 39.0% | 11.7% | 0.0% | 50 / 40 / 10 / 0 | Yes |
| `budget` | rerun | 48.9% | 39.5% | 11.6% | 0.0% | 50 / 40 / 10 / 0 | Yes |
| `standard` | run | 20.7% | 49.3% | 28.9% | 1.1% | 20 / 53 / 26 / ≤ 1 | Yes |
| `standard` | rerun | 21.2% | 49.3% | 28.3% | 1.2% | 20 / 53 / 26 / ≤ 1 | Yes |
| `premium` | run | 0.0% | 49.3% | 47.7% | 3.0% | 0 / 50 / 47 / ≤ 3 | Yes |
| `premium` | rerun | 0.0% | 48.9% | 47.9% | 3.2% | 0 / 50 / 47 / ≤ 3 | Yes |

### Reviewer slot (non-slot launches: n = 424 run, 422 rerun)

| Mode | Run | `basic` | `broad` | `deep` | `frontier` | Target | In range |
|---|---|---|---|---|---|---|---|
| `budget` | run | 44.3% | 40.6% | 15.1% | 0.0% | 50 / 40 / 10 / 0 | Yes |
| `budget` | rerun | 43.4% | 41.7% | 14.9% | 0.0% | 50 / 40 / 10 / 0 | Yes |
| `standard` | run | 19.8% | 43.2% | 35.4% | 1.7% | 20 / 53 / 26 / ≤ 1 | Yes (`broad` −9.8, `deep` +9.4) |
| `standard` | rerun | 20.1% | 44.1% | 34.6% | 1.2% | 20 / 53 / 26 / ≤ 1 | Yes (`broad` −8.9, `deep` +8.6) |
| `premium` | run | 0.0% | 44.3% | 52.4% | 3.3% | 0 / 50 / 47 / ≤ 3 | Yes |
| `premium` | rerun | 0.0% | 43.4% | 52.4% | 4.3% | 0 / 50 / 47 / ≤ 3 | Yes |

**Frontier against the cap:** with no slot, `frontier` is at or just above the cap: 1.1–1.2% against 1% for `standard`, and 3.0–3.2% against 3% for `premium`. With the reviewer slot it is 1.2–1.7% and 3.3–4.3%. The cap applies to the window, while these shares count every launch, including the first 100 decided on the seed candidate.

**Decision reasons:** `cut` decided every non-slot launch except the `frontier` ones: 9–10 (`standard`) and 25–26 (`premium`) with no slot, 5–7 and 14–18 with the reviewer slot. The slot took 391–393 reviews and 5 scout launches.

## Rerun noise

The plain rerun asked Jev the same 820 requests again. Then the decided target of a launch (a tier or the slot) changed between the run and the rerun:

| Mode | No slot | Reviewer slot |
|---|---|---|
| `budget` | 46 of 820 (5.6%) | 46 of 820 (5.6%) |
| `standard` | 63 of 820 (7.7%) | 48 of 820 (5.9%) |
| `premium` | 38 of 820 (4.6%) | 41 of 820 (5.0%) |

## Reading

- **Every mode is in range** in both scopes, in the run and the rerun. With no slot, every tier is within 4 points of its target.
- **With the reviewer slot,** the remaining launches lean to `deep`: `standard` sits near the edge of the range (`broad` −9.8, `deep` +9.4 points), and `budget` and `premium` move 5–6 points. *Hypothesis, not measured:* the first 100 launches of each stream are decided on the run's seed candidate, which was computed over all 820 answers, reviews included. If the non-slot launches score higher than the reviews the slot takes away, those early launches land above the cuts more often. Slot launches never enter the window, so the cuts computed later come from non-slot launches only. These aggregates have no per-window data, so the size of the seed-candidate effect is not known.
- **Ties:** the scores are coarse, but no mode misses its target because many launches share one score. The effort tiebreak considered in the change's design is not needed.
- **Noise:** 4.6–7.7% of launches change target between two identical runs, close to the 3.3–5.2% of the rubric-2 replay.

No values were tuned after this replay. The seed and targets are the ones shipped.
