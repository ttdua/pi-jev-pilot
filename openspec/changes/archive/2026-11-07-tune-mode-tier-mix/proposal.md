## Why

Issue #39 sets a target tier mix per mode. Today each mode sends its own tier wording, so the mix depends on the wording and on the workload. Only `premium` meets its target, and `standard` moved between the 2026-11-05 and 2026-11-07 replays under the same rubric. Rewording would fit one sample and then drift again. An offline spike on 4404 recorded answers showed that percentile cut points on one shared difficulty score meet every range. Recomputed from recent ledger lines, they follow workload drift, so the mix holds without anyone retuning wording.

## What Changes

**What a mode is**
- From: each mode selects a tier rubric, an `expert_needed` wording and an expert gate (ADR 0003).
- To: every mode asks the same worker tier question (today's `standard` wording). A mode is a target table: `budget` 50/40/10/0, `standard` 20/53/25/≤2, `premium` 0/50/45/≤5, for `fast`/`balanced`/`deep`/`expert`.
- Reason: wording moves the mix once; a target table holds it.
- Impact: behaviour change in every mode for worker routing; the main request is unchanged.

**How a worker tier is decided**
- From: Jev's tier choice, adjusted by the expert gate, risk floor and the `fast` probability bar.
- To: Jev's tier probabilities and effort give a difficulty score. The mode's cut points turn the score into `fast`, `balanced` or `deep`. `expert` needs a score above the mode's expert cut and effort `xhigh` or `max`, and is capped, never filled to quota. The `fast-unsure` rule goes. The risk floor, slots and fallback stay.
- Reason: cut points hit a share directly; a harder brief never gets a cheaper tier than an easier one in the same mode.
- Impact: reasons recorded in the ledger change.

**Where cut points come from**
- From: nothing; there are no cut points.
- To: they are recomputed from the recent tier-routed worker lines in the ledger, pooled across modes. Seed cut points from the 2026-11-07 replay ship with the package and apply until enough lines exist.
- Reason: fixed cut points drift as the launch mix changes, for example when a reviewer slot takes the reviews.
- Impact: no new store file; routing reads the ledger.

**Worker request and ledger line**
- The `expert_needed` question is no longer sent to workers.
- The worker ledger line gains the difficulty score and the rubric version, so lines asked under another rubric are left out of the window.

**Visibility**
- `/jev` shows the recent worker mix next to the mode's target.

**Decision record**
- A new ADR replaces ADR 0003. It records that recomputing cut points keeps the operator's target fixed and is therefore not tuning in the sense of ADR 0005.

Docs updated: `docs/decisions/` (new ADR, ADR 0003 marked superseded, index), `docs/domain-model.md` (modes, decision order, expert gates), `docs/glossary.md` (rubric, mode, expert gate, cut point, difficulty score), `docs/jev-contract.md` (worker questions, `expert_needed`), `docs/jev-questions.md` (one worker tier rubric), `docs/architecture.md` (rubrics as data, `modes.ts`, new policy module), `docs/configuration.md` (expert tier note, calibration row), `docs/workflow.md` (mode switch flow), `docs/usage-guide.md` (mode table), `docs/roadmap.md` (#39 status), and a dated `docs/evidence/` replay note with aggregates only.

## Capabilities

### New Capabilities
- `mode-cutpoints`: computing cut points from a window of difficulty scores and a mode's target table, the expert cap, the window's eligible ledger lines, and the shipped seed.

### Modified Capabilities
- `worker-modes`: a mode selects a target table instead of a rubric, an `expert_needed` wording and an expert gate.
- `worker-decision`: the decision order uses the difficulty score and cut points; the expert rule needs the expert cut and `xhigh` or `max` effort; rule `fast-unsure` is removed.
- `worker-request`: one tier wording for every mode; no `expert_needed` question.
- `worker-routing`: routing reads the ledger window and computes the mode's cut points for each launch.
- `worker-ledger`: the worker line carries the difficulty score and the rubric version.
- `decision-ledger`: the worker line schema gains those two fields.
- `jev-command`: the status report shows the recent worker mix against the mode's target.
- `verbose-log`: the worker log line hides `why cut`, as it hid `why choice`.
- `strategy-advice`: the main `tier` criteria are named as their own text, no longer "the `standard` rubric".

## Impact

- Code: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/policy/modes.ts`, `src/policy/tier.ts`, a new pure module for cut points, `src/host/worker.ts`, `src/host/commands.ts`, `src/store/ledger-schema.ts`, and their tests.
- Requests: still one Jev request per worker launch, one question shorter. No new dependency, no new store file.
- Unchanged: the main request and its `tier` question, strategy advice, effort rules, tool assessment, slot routing and WG-18 tuning.
- Older ledger lines are still valid. They carry no rubric version, so they stay out of the window.
