## Design Summary

Issue #39 asks each mode to route workers at a target tier mix, with every tier within ±10 percentage points of its share. This change reaches the targets by changing what a mode is, not by rewording rubrics.

**Today** each mode sends Jev its own tier wording, and Jev's choice is the tier. The mix then depends on both the wording and the workload. The 2026-11-07 replay shows the cost: `standard` did not reproduce the 2026-11-05 mix under the same rubric, because the workload had changed. Tuning wording until today's 1101 briefs fit would drift again with the next workload shift or Jev release.

**After this change**:
- Every mode asks Jev the same worker tier question, today's `standard` wording. Jev's answer becomes one difficulty score per brief.
- A mode is a target mix: three cut points that split the scores into `fast`, `balanced` and `deep`, plus a cap on `expert`.
- The cut points are recomputed from the recent worker lines in the ledger, so the mix follows the target as the workload moves.

```
brief -> Jev (one request, same tier question in every mode)
           -> difficulty score
           -> mode cut points (from recent worker lines) -> tier
              expert only above the top cut AND with high effort
              risk floor still raises to deep
```

**What each mode means**

| Mode | Behaviour | Target `fast` / `balanced` / `deep` / `expert` |
|---|---|---|
| `budget` | The easier half runs on `fast`, the hardest tenth on `deep`, never `expert` | 50 / 40 / 10 / 0 |
| `standard` | The easiest fifth on `fast`, the middle on `balanced`, the hardest quarter on `deep`, at most 2% on `expert` | 20 / 53 / 25 / ≤2 |
| `premium` | Never `fast`, the easier half on `balanced`, the rest on `deep`, at most 5% on `expert` | 0 / 50 / 45 / ≤5 |

The operator set these targets in the #39 discussion. They replace the issue's original table: `standard` expert dropped from 5% to at most 2%, and `premium` expert from 10% to at most 5%, with the difference moved to `balanced` and `deep`. Expert is a ceiling, not a quota: a launch reaches it only when Jev also rates the worker effort `xhigh` or `max`, so a quiet period may route less than the cap.

**Why**
- **The operator's goal:** each mode spends a predictable share on each model, and keeps doing so without anyone rewording rubrics.
- **Workers only:** the operator picks the main model by hand, so the main session does not change. The worker is what this change routes.
- **Ordering:** a harder brief never gets a cheaper tier than an easier one within a mode. Today `budget` can send a brief that `standard` scores mostly `deep` down to `fast`.

**Goals**
- Every mode stays inside every allowed range over the recent tier-routed launches, with or without a reviewer slot configured.
- One Jev request per launch, as today; no extra latency.
- No routine retuning: workload shifts and slot changes are absorbed automatically.

**Non-goals**
- Changing the main request, its `tier` question, or the strategy advice gates that read it.
- Making effort follow the mode. `high` is chosen on 71% of worker briefs in every mode; that is a separate issue.
- Measuring the quality of work per tier.
- Auto-tuning of other parameters (WG-18 and ADR 0005 keep their scope).

**Anti-goals**
- Filling the expert cap with briefs that do not need it.
- A mix that only fits the replay sample and drifts afterwards.
- A new store file holding state the ledger already has.

### Evidence from the offline spike

The spike ran on the 4404 recorded WG-12 replay answers (1101 briefs × `budget`, `standard`, a `standard` rerun and `premium`), with no new requests. Aggregates only; scripts live outside the repository.

- **Resolution:** the score takes 176 to 290 distinct values. The largest tie holds about 2.6% of launches, so cut points do not collapse onto one value, which was the failure in ADR 0003's threshold test.
- **Fit:** cut at percentiles, all three modes meet every range over all launches and over non-review launches, and still do on the plain rerun, where 2–6% of briefs change tier. Fitting the cuts on one random half and checking the other half met the target in 50 of 50 splits, with the largest deviation 7–10 points.
- **Drift:** cuts fitted on non-review launches and applied to all launches put `budget` and `premium` outside their ranges. Fixed cuts drift with the workload.
- **Recomputed cuts:** in launch order, with project-grouped briefs as a pessimistic drift case, recomputing from the latest 200 launches kept 400-launch windows in range in 13–15 of 15 windows over all launches, and 4 of 4 over non-review launches. Fixed cuts managed 0–14, and recomputing every 100 launches over a 400-launch window managed 2–10.
- **Expert:** a cap with an effort condition picks the right briefs. At a 2% cap on `standard`, 20 of 22 selected briefs are also `expert` under today's `premium` gate. At 5% on `premium`, 51 of 54 are.
- **Ledger capacity:** in the operator's sessions since 2026-10-25 there were 5346 user messages and 2109 `subagent` calls. Worker lines would fill at least a quarter of the 2000-line ledger, well above 200.

## Alternatives Considered

### Alternative A: Reword the rubric per mode
- **Approach**: as #39 first proposed, write new tier wording for `budget` and `standard` and a softer `standard` expert question. Iterate by replay until each mode fits.
- **Pros**: keeps ADR 0003; no new mechanism; no ledger change.
- **Cons**: each variant costs about 1100 requests, with no guarantee of converging. The fit is to one sample and drifts with workload and Jev releases (2026-11-05 vs 2026-11-07). Shared wording couples the modes and the main request.
- **Why not chosen**: it meets the target once, not over time, which is what the operator asked for.

### Alternative B: Fixed percentile cut points from the replay
- **Approach**: the same single rubric and score, with cut points computed once from the replay and shipped as constants. They are re-derived by hand when the mix drifts.
- **Pros**: simplest code; no ledger reads in routing.
- **Cons**: the spike shows fixed cuts leave the ranges as soon as the launch mix shifts, for example when a reviewer slot takes the reviews.
- **Why not chosen**: it turns drift into a manual chore, which the change exists to remove.

### Alternative C: A separate thresholds store
- **Approach**: recompute cut points in batches and persist them in a new file next to `tuning.json`.
- **Pros**: an explicit history of cut-point changes; could support undo.
- **Cons**: duplicates what the ledger already holds; adds a schema, recovery rules and a second source of truth. In the spike, batch updates over long windows tracked drift worse than a short rolling window.
- **Why not chosen**: more moving parts for a worse result.

## Agreed Approach

The difficulty score with percentile cut points recomputed from the ledger. It came out of the operator's choice of "spike first, then decide" (#39 discussion). The spike showed it meets every range, survives a rerun and follows workload drift, which neither reworded rubrics nor fixed cuts do. Seed cut points from the 2026-11-07 replay cover a fresh install until enough worker lines exist.

## Key Decisions

- **One worker tier question for every mode**, the current `standard` wording. The `budget` and `premium` tier wordings and the per-mode expert questions are removed from worker requests.
- **A mode is a target table**, three cut points and an expert cap. No other worker rule varies by mode.
- **Targets**: `budget` 50/40/10/0, `standard` 20/53/25/≤2, `premium` 0/50/45/≤5, each tier within ±10 points. Expert is a cap, not a quota.
- **Expert needs effort `xhigh` or `max` as well as a top score**, as today's `premium` gate already requires. Lowering the current `expert_needed` bar does not work: on `standard` answers that probability never exceeded .50, and a bar of .3 admits under 1% of launches.
- **Cut points come from the ledger**, recomputed from recent tier-routed worker lines. Launches routed to a slot, left untouched or missed are not counted, so one table serves setups with and without a reviewer slot (the operator asked for both).
- **One pooled window for all modes** (my call): the score does not depend on the mode, so lines from every mode count, and switching mode needs no cold start. The spike computed every mode's cuts from one pool of `standard` answers.
- **The window holds scores, not tiers** (my call). A tier-routed launch counts whatever tier it ended on, including launches raised to `deep` by the risk floor. The mix checked against the target is the decided tier, before fallback, since fallback reflects model availability rather than routing.
- **The "unsure fast" rule goes** (my call): the `fast` cut point replaces it, and keeping it would push launches off the target.
- **The `expert_needed` question is no longer sent to workers** (my call): no rule reads it any more, and dropping it shortens the request.
- **Seed cut points ship with the package**, derived from the 2026-11-07 replay, and apply until enough worker lines exist.
- **Worker ledger lines record the score and the rubric version**, so lines asked under a different rubric are not mixed into the window.
- **No new store and no reserved worker capacity in the ledger.** Measured worker volume makes reserved capacity unnecessary; with too few lines the seed applies.
- **Unchanged**: the main request and its `tier` wording, strategy advice, the risk floor, slot routing, fallback, and the rule that a denied expert becomes `deep`.
- **Not tuning**: recomputing cut points keeps the operator's target fixed, so it is outside ADR 0005 and WG-18. A new ADR replaces ADR 0003 and says so.
- **Visibility**: `/jev` shows the recent mix against the mode's target. It was in the scope shown to the operator, but the last scope summary they approved did not repeat it, so it stays in scope unless the review removes it.
- **Replay data**: the WG-12 replay briefs and recorded answers stay outside the repository, on the operator's machine, with the replay harness. The seed cut points and the done-when replay are computed there, and only aggregates are committed.
- **Done when** (from #39, adapted): an offline replay of real briefs, run in launch order with the plain rerun, keeps every mode inside every range. `docs/jev-questions.md`, `src/jev/rubrics.ts`, `docs/usage-guide.md` and a dated `docs/evidence/` note are updated, with aggregates only.

## Open Questions

- The exact score formula, window size, minimum line count and how cut points move between launches. The spike used a 200-line window and a 100-line minimum; these are left to `design.md`.
- Where the recent mix appears: `/jev` output only, or also the status line.
- Whether a Jev release should bump the rubric version. The spike suggests rolling cut points absorb a scale shift, but this is untested.
