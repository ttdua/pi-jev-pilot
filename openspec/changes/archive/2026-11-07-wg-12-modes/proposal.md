## Why

The mode is stored, resolved, shown and logged, but nothing can set it and nothing reads it when routing a worker: every launch uses the `standard` rubric and a single fixed rule for the `expert` tier. The operator cannot shift work toward cheaper or stronger models, which the project brief lists as a goal, and the ledger cannot yet separate tuning signals by mode. The rule is also named after one vendor's model ("Fable"), although a tier is a role; nothing is released, so renaming it now costs no migration.

## What Changes

**Setting the mode**
- From: `/jev mode premium` prints the usage text.
- To: `/jev mode <budget|standard|premium>` writes the mode to `state.json`, then reports the status and redraws the status line. Any other mode word prints the usage text.
- Reason: roadmap WG-12; selected feature G6.
- Impact: new public command form, approved by the operator.

**Tier rubric per mode**
- From: the worker `tier` question always uses the `standard` criteria.
- To: it uses the active mode's criteria (`budget`, `standard`, `premium`), kept as data. The main request keeps the `standard` criteria.
- Reason: ADR 0003; measured in the 2026-11-05 replay.
- Impact: non-breaking; `standard` requests are unchanged byte for byte.

**`expert_needed` wording per mode**
- From: one wording.
- To: `premium` asks the softer wording from `docs/jev-questions.md`; `budget` and `standard` keep the current one.

**Expert gate per mode**
- From: rule `fable`, always "`tier` is `expert` and `expert_needed > .9`".
- To: rule `expert-admitted`, selected by mode. `budget` and `standard` keep that condition. `premium` admits `expert` when `tier.choice` is `deep` or `expert`, `P(expert) ≥ .1` and `effort.choice` is `xhigh` or `max`.
- Reason: in replay `expert_needed` never passed .9; `premium` needs its own gate.
- Impact: `standard` decisions are unchanged except for the reason name.

**Model-neutral naming**
- From: "Fable rule" in docs and specs; ledger `reason` `fable`.
- To: "expert gate"; ledger `reason` `expert-admitted`, paired with `expert-denied`.
- Reason: a tier is a role; the configured expert model can change.
- Impact: ledger value change in an unreleased format. No ledger written by this package exists outside test runs, so no alias is kept.

**Done-when replay**
- A replay of real briefs per mode is a final manual task, run outside the repository after the operator approves its data and cost. The roadmap row moves to Done only after it.

## Capabilities

### New Capabilities
- `worker-modes`: the mode names, which rubric and expert gate each mode selects, and that a mode changes nothing else.

### Modified Capabilities
- `worker-decision`: rule 1 becomes `expert-admitted`, decided by the mode's expert gate; the decision takes the mode.
- `worker-request`: `tier` criteria and `expert_needed` wording follow the mode.
- `decision-ledger`: worker `reason` value `fable` is replaced by `expert-admitted`.
- `jev-command`: new `/jev mode <m>` form; usage text lists it; the "later work group" scenario no longer uses `mode`.
- `worker-routing`: a worker launch uses the mode read when it is classified, for its questions, decision and ledger line.
- `worker-ledger`: the line's `mode` is the mode captured at classification.

## Impact

- **Code:** `src/policy/modes.ts` (new), `src/policy/tier.ts`, `src/policy/route.ts`, `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/host/worker.ts`, `src/host/commands.ts`, `src/store/ledger-schema.ts`.
- **Tests:** `tests/policy/tier.test.ts`, `tests/policy/route.test.ts`, `tests/policy/modes.test.ts` (new), `tests/jev/questions.test.ts`, `tests/host/commands.test.ts`, `tests/host/worker-routing.test.ts`, `tests/store` ledger schema tests.
- **Docs updated:** `docs/domain-model.md`, `docs/jev-contract.md`, `docs/jev-questions.md`, `docs/glossary.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/roadmap.md`, `docs/decisions/0003-rubric-per-mode.md`. `docs/evidence/` is left as recorded, since it is a dated measurement.
- **No** new dependency, config field, schema version or migration.
