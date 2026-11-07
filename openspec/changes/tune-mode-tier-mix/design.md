## Context

Worker routing builds one Jev request per launch (`src/host/worker.ts` → `buildWorkerQuestions` in `src/jev/questions.ts`). The `tier` criteria and the `expert_needed` wording come from `TIER_CRITERIA[mode]` and `EXPERT_NEEDED_QUESTIONS[mode]` in `src/jev/rubrics.ts`. The answers go to `decideTier` (`src/policy/tier.ts`), which applies `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure` and `choice` in that order. Only `expert-admitted` reads the mode, through `expertAdmitted` in `src/policy/modes.ts`. Each launch then writes one `worker` ledger line with `tierP`, `effortP`, `risky`, `expertNeeded`, `tier`, `reason` and `mode` (`src/store/ledger-schema.ts`). The ledger keeps the latest 2000 valid lines across two segments, and `readLedger` returns them oldest first.

The main request reuses `STANDARD_TIER_CRITERIA` for its own `tier` question through `MAIN_TIER_QUESTION`. The strategy gates read that question.

Constraints: `policy/` is pure and imports only itself and `shared/`; `store/` imports only itself and `shared/`; only `host/` touches Pi. No prompt text is stored. Fail open on any Jev or ledger problem.

Evidence: the offline spike on the WG-12 replay answers (see brainstorm.md). Its scripts and data stay outside the repository.

## Goals / Non-Goals

**Goals:**
- Each mode's worker mix stays within ±10 points of its target over recent tier-routed launches, with or without a reviewer slot.
- One pure function turns a window of scores and a target table into cut points, and one pure function turns answers and cut points into a tier. Both are table-testable.
- No extra Jev request, no extra latency on the launch path beyond reading an in-memory window.

**Non-Goals:**
- The main request, its `tier` question and the strategy gates.
- Effort selection, tool assessment and slot routing rules.
- Cross-process sharing of the window during a session.
- Measuring work quality per tier.

## Decisions

**D1. One worker tier rubric.** `TIER_CRITERIA` and `EXPERT_NEEDED_QUESTIONS` become one `WORKER_TIER_CRITERIA`, today's `standard` wording verbatim. `buildWorkerQuestions` no longer takes a mode, and no longer asks `expert_needed`. `MAIN_TIER_QUESTION` keeps its own copy of the `fast`, `balanced` and `deep` criteria, so later edits to the worker rubric cannot move the strategy gates. A `RUBRIC_VERSION` constant (integer, starting at `2`; the per-mode rubrics count as `1`) lives next to the wording. Editing the worker wording means raising it.
*Alternative:* keep the mode parameter and pass the same data for every mode. Rejected: it hides that the mode no longer affects the request.

**D2. Difficulty score.** `score = Σ rank(t) · P̂(t) + 0.5 · rank(effort) / 4`. The tier ranks are `fast` 0, `balanced` 1, `deep` 2, `expert` 3. The effort ranks are `low` 0 to `max` 4. `P̂` is the `tier` probabilities restricted to tier keys and renormalized, so slot keys and missing tiers do not shift the scale. The range is 0–3.5. The score is rounded to 3 decimals and stored on the ledger line. Without a `tier` answer there is no score. Without an `effort` answer, effort counts as `high`, the median answer (my call). The spike tried effort weights of 0, 0.5 and 1. 0.5 had the most distinct values with similar fit and noise.
*Alternative:* the expected rank alone. Rejected: ties are larger (176 distinct values against 290), and effort carries the "verify hard" signal the operator wants for expert.

**D3. Target tables in `policy/modes.ts`.** `MODE_TARGETS: Record<ModeName, { fast, balanced, deep, expertCap }>`, as whole percents that sum to 100:

| Mode | fast | balanced | deep | expertCap |
|---|---|---|---|---|
| `budget` | 50 | 40 | 10 | 0 |
| `standard` | 20 | 53 | 25 | 2 |
| `premium` | 0 | 50 | 45 | 5 |

`expertAdmitted` and both expert gates are removed.

**D4. Cut points, new module `policy/cutpoints.ts`.** `cutPoints(scores: readonly WindowEntry[], target) → { fastMax, balancedMax, expertMin }`, where `WindowEntry = { score, effort }`. Over the sorted scores:
- `fastMax` is the score at the position given by rounding `target.fast · n` half up (at least 1), or −∞ when the share is 0.
- `balancedMax` is the score at the rounded position of `(fast + balanced) · n`.
- `expertMin` is the lowest score s above `balancedMax` such that the entries with score ≥ s and effort `xhigh` or `max` make up at most `expertCap` of the window. It is +∞ when the cap is 0 or no s qualifies.
- An empty window gives +∞ for all three (only reachable in direct tests, since an empty window uses the seed).

Targets are held as whole percents and positions computed in integers, so no float rounding decides a position. Rounding half up rather than ceiling matched the spike's fit.

Ties resolve upward: a score equal to `fastMax` is `fast`. The function is pure, deterministic and independent of input order.

**D5. Tier decision.** The new order is `expert`, `risky`, `slot`, `cut`, the same positions as today's rules. The first match wins, and the reason names the rule:
1. `expert`: `expert` is offered, the score is at least `expertMin`, and effort is `xhigh` or `max`.
2. `risky`: unchanged. `risky > .7` gives `deep`, or the highest offered tier below `expert`.
3. `slot`: unchanged (P ≥ .6).
4. `cut`: the score gives `fast` (≤ `fastMax`), `balanced` (≤ `balancedMax`) or `deep`. A tier that is not offered moves to the nearest offered tier below it, else the nearest above it, never `expert`.

Reasons `expert-admitted`, `expert-denied`, `fast-unsure` and `choice` are retired. The new reasons are `expert` and `cut`; `risky` and `slot` stay. Keeping the order means an admitted expert still beats the risk floor and a slot, as today. Fallback, effort rules and the thinking clamp are unchanged.
*Alternative:* keep `expert-denied` for a Jev `expert` choice that misses the cut. Rejected: the cut already places it on `deep` or lower by score.

**D6. The window.** A host-side module (`host/cutpoint-window.ts`) keeps the latest 200 eligible entries in memory. At `session_start` it is loaded from `readLedger`. After that it is extended in memory each time this session builds a valid worker line, in the same place the tally is fed. A line is eligible when all of the following hold:
- `kind` is `worker` and `rubric` equals `RUBRIC_VERSION`;
- it has a `score`;
- `reason` is `risky`, `expert` or `cut`; slot, untouched and miss lines are left out;
- `expert` was offered when the line was written, recorded as a boolean `expertOffered` (my call). Lines from a setup without the `expert` tier would otherwise skew the expert cut.

Lines from every mode are pooled. Cut points are recomputed from the window before each batch of sibling launches, using the mode captured for each launch. With fewer than 100 eligible entries, the seed applies.
*Alternative:* re-read the ledger at every launch. Rejected: it adds file I/O to the launch path and gains only other processes' lines.
*Alternative:* a window per mode. Rejected: the score does not depend on the mode, and a pool avoids a cold start after a mode switch.

**D7. Seed cut points.** `SEED_CUTPOINTS: Record<ModeName, CutPoints>` in `policy/seed.ts` (data only; `cutPointsFor` in `policy/cutpoints.ts` picks it below 100 entries) is computed from the 2026-11-07 replay answers with the D2 formula and the D4 rules. The values are written to the evidence note. The tests check that `cutPoints` reproduces them from a fixture of synthetic scores with the same quantiles; the real scores are not stored.

**D8. Ledger line.** The `worker` line gains three optional fields:
- `score`, a number from 0 to 3.5;
- `rubric`, an integer from 1 to 99;
- `expertOffered`, a boolean.

`expertNeeded` stays in the schema as an optional field, so older lines remain valid. New lines no longer write it. The `reason` enum gains `expert` and `cut` and keeps the retired names for old lines. The deciding-reason rule ("`tier` required for this reason") covers the new reasons.

**D9. `/jev` status.** When routing is on, the status report gains:
- a `mix:` line with the window's decided-tier shares and their target, for example `mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2`;
- `cut points: seed` while the seed applies.

The status line above the editor is unchanged (my call; it is already dense). The command still never calls Jev.

**D9b. Neighbouring specs.** The verbose log hides `why cut` as it hid `why choice`, so routine lines stay short. The strategy-advice spec names the main criteria as their own text.

**D10. ADR 0008 replaces ADR 0003.** It records the target-table model of a mode and the rolling cut points. It also records that recomputing cut points is not tuning under ADR 0005: the operator's targets never change automatically, and no value is written to any store.

## Risks / Trade-offs

- [The workload in one session differs from the pooled window, so a short session drifts from target] → The target is judged over the window, not per session; 200 entries cover several sessions at the measured volume.
- [Several Pi processes do not see each other's lines until their next session start] → The ledger is shared on disk, so every new session starts from all processes' lines. The in-session lag is bounded by session length.
- [A Jev release shifts the score scale] → Rolling cut points follow a scale shift. Only a change to the wording itself needs a new `RUBRIC_VERSION` and seed.
- [Feedback loop: routing outcomes change later briefs] → The score is computed before the tier is chosen and does not read past tiers. The loop goes only through the workload, which the window is meant to follow.
- [Reviews dominate the window without a reviewer slot, so implementation launches get cheaper tiers in `budget`] → This is the intended reading of a per-mode share over all launches. With a reviewer slot, reviews leave the window. The `/jev` mix line makes this visible.
- [Rollback: older code rejects lines with the new fields] → `readLedger` skips invalid lines, so older code only loses those lines from its own reads. No data is rewritten.
- [Seed accuracy for other operators] → The seed comes from one operator's workload. It applies only until 100 eligible lines exist, which takes a few days of normal use.

## Migration Plan

1. Ship the code, ADR, spec and docs together; the first launches use the seed.
2. Existing ledger lines stay valid and are ignored by the window, since they have no `rubric`.
3. Rollback is a revert of the change. The ledger needs no cleanup.

## Open Questions

- None blocking. The window size (200) and minimum (100) are constants, chosen from the spike. They can change later with replay evidence.
