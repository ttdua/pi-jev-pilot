## Why

On some providers a thinking-level change between turns invalidates the prompt cache, so the per-prompt effort decisions from WG-07 make every changed turn pay a full cache rewrite. A5 asks the package to keep the first decision on those providers (`effort.holdProviders`, default `["9router"]`) until the context is rebuilt anyway, by a compaction or a model change. The setting already exists in `config.json` but nothing reads it.

## What Changes

**Effort on a held provider**
- From: every eligible prompt asks `effort`, `risky` and `corrects` and may change the level.
- To: when the provider is in `effort.holdProviders` and the current branch, after its latest compaction, already holds a decided turn for the same provider and model, the prompt is held: only `corrects` is asked and the level is not touched. The first decided turn after the session start, a compaction, or a provider or model change decides as before.
- Reason: A5; avoid cache loss on providers that lose it.
- Impact: non-breaking; providers outside the list behave as in WG-07.

**Turn entry**
- From: the `jev-turn` session entry holds exactly `{ turnId }`.
- To: a turn that was not held, produced an effective level, and saw no compaction before it settled also records `decided` with its provider, model and level, so a later prompt finds the anchor on the branch. Other turns keep `{ turnId }`.
- Reason: hold state must survive reload and resume and follow forks and `/tree`.
- Impact: additive to the session entry; older entries without `decided` simply do not anchor.

**Ledger line**
- From: `held` MUST be absent from `main` lines.
- To: a held turn's `main` line carries `held` `true` and `effective` (the level in force), and no `effortP`, `risky` or `requested`.
- Impact: additive; the field is already in the ledger schema.

**Status line**
- From: a request that did not ask `effort` leaves the suffix as it was.
- To: a held turn shows the level in force as the suffix.

## Capabilities

### New Capabilities
- `effort-hold`: deciding whether a main prompt is held, from the provider list and the anchor on the current branch, and what a held turn does.

### Modified Capabilities
- `main-effort`: the main questions omit `effort` and `risky` on a held prompt.
- `main-ledger`: `held` on held `main` lines; `jev-turn` may carry `decided`.
- `status-line`: a held turn sets the suffix to the level in force.

## Impact

- Code: `src/host/main.ts`, `src/host/context.ts`, `src/jev/questions.ts`, a new pure module under `src/policy/`, `src/host/status.ts` unchanged in shape.
- Tests: `tests/policy/`, `tests/host/main.test.ts`, a new host test for hold with compaction.
- Docs: `docs/workflow.md` (main prompt, compaction), `docs/domain-model.md` (hold rule, `held` field), `docs/roadmap.md` (WG-08 status), `docs/usage-guide.md` if the held status needs a line.
- No new dependency, no config format change, no command change.
