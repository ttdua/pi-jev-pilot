## Context

WG-07 (`src/host/main.ts`) asks Jev at every eligible `before_agent_start`, applies the level, and when the run settles writes one `main` ledger line and a `jev-turn` custom entry `{ turnId }`. `effort.holdProviders` is validated and resolved (`src/store/config.ts`, `src/store/settings.ts`) but unused. `held` exists in the ledger schema (`src/store/ledger-schema.ts`) but `main-ledger` forbids it. Pi writes a `compaction` entry to the branch on every compaction, and `ctx.sessionManager.getBranch()` returns the current branch in order.

## Goals / Non-Goals

**Goals:**
- Decide "held or not" from the provider list and the current branch only, so reload, resume, fork and `/tree` give the right answer.
- Keep the WG-07 path untouched for providers outside the list.
- Keep `policy/` pure: the host extracts plain facts, a pure function decides.

**Non-Goals:**
- Reacting to `session_compact` with state; the branch already shows the compaction.
- Restoring the anchor's level if the operator changes it while held.

## Decisions

**D1. Anchor marker in `jev-turn`.** A turn with an effective level writes `jev-turn` as `{ turnId, decided: { provider, model, level } }`; other turns keep `{ turnId }`. Reusing the existing entry keeps one package entry per turn, and the correction lookup keeps reading `turnId` unchanged. A separate `jev-hold` entry type was considered; it doubles the entries and splits one turn's facts in two. `provider`, `model` and `level` are identifiers, not prompt text, so the privacy rule holds.

**D2. Anchor lookup.** `holdContext(entries)` in `src/host/context.ts` walks the branch from the end and stops at the first `compaction` entry; it returns the newest `jev-turn` `decided` it finds (or none) and that compaction's id. The pure rule `isHeld({ provider, model, holdProviders, anchor })` in `src/policy/hold.ts` returns true only when the provider is listed, an anchor exists, and its provider and model equal the current ones. Held turns write no `decided`, so the anchor stays the decided turn, which is still on the branch after any number of held turns.

**D3. When a turn counts as decided.** `decided` is written exactly when the turn's record has `effective`, was not held, and the id of the latest `compaction` entry on the branch at settle equals the one captured at the prompt (an overflow compaction inside the turn would otherwise put a stale anchor after the compaction). Effective means: the level was applied, already equal to the target, or `max` was kept. A miss, a discard or an unanswered `effort` writes no `decided`. Esc with no provider request, or a Jev request reported `cancelled`, already writes no entry at all. A turn aborted after its first provider request does anchor: that request already carried the level, so the cache was written at it (my call).

**D4. Held prompt flow.** Hold is checked before the request is built. A held prompt calls `mainQuestions({ askEffort: false })`, so only `corrects` is sent, and never calls `pi.setThinkingLevel`. The record gets `held: true` and `effective` = the level read once the Jev request completes, so a manual change during the wait is recorded as it is. Its `main` line carries `held`, `effective` and `from`, and no `effortP`, `risky` or `requested`. A Jev miss on a held prompt still records `held` and `effective`, since the level did not depend on Jev. The status suffix is set to the level in force, also on a miss, since the hold does not depend on Jev.

**D5. Provider identity.** `ctx.model.provider` and `ctx.model.id` at the prompt. A model switch inside a held provider gives a different `model`, so the next prompt decides once and becomes the new anchor.

**D6. `holdProviders` read per prompt** from the snapshot already loaded in `decide`, so a config edit applies to the next prompt.

## Risks / Trade-offs

- [The operator changes the level by hand while held] → The package keeps whatever is set and records it as `effective`; the hold never fights the operator.
- [`/jev effort off` then on] → The anchor is still on the branch, so the hold continues; this matches "first decision kept for the session".
- [Pi stops writing `compaction` entries to the branch] → The host test after a compaction would fail, flagging the host change.
- [Branch scan cost] → One reverse scan per prompt, bounded by the entries since the last compaction; the state builder already reads the same branch.
- [Overflow compaction with `willRetry` inside a decided turn] → D3 drops that turn's `decided`, so the next prompt decides; the retry does not pass `before_agent_start`. Still exactly one.
