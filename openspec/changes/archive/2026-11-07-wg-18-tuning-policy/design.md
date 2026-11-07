## Context

`src/store/settings.ts` already resolves `tuning > state > config > default`, with a placeholder tuning layer `{ classifier?: { timeoutMs?: unknown } }` that accepts integers 300–5000. No module reads or writes `tuning.json` yet, and `src/host/readiness.ts` calls the resolver without tuning. Ledger lines (`src/store/ledger-schema.ts`) carry `kind`, `at`, `answered`, `miss` and `ms`. A main line's `at` is the prompt time, and a worker line's `at` is the completion time. `readLedger` returns the latest 2000 valid lines, oldest first. `state.json` (`src/store/state-file.ts`) sets the pattern for a small atomic JSON store with `missing`, `malformed` and `unreadable` reads.

Constraints: `policy/` imports only itself and `shared/`; `store/` imports only itself and `shared/`; no Pi imports outside `host/`.

## Goals / Non-Goals

**Goals:**
- One pure step function the host can call at `agent_settled`, plus pure transitions for undo, reset and off.
- A tuning record that alone, without the ledger history before the change, is enough to judge a revert.
- `tuning.json` behaves like `state.json` on bad input.

**Non-Goals:**
- Calling the step, showing lines, `/jev tune` text, per-mode observed signals (host change).
- Cross-process locking.

## Decisions

**D1. Plain types on both sides of the store boundary.** Pure counting helpers live in `policy/tuning-window.ts`; the rules and transitions in `policy/tuning.ts`, where `stepTuning` only composes named helpers. `policy/tuning.ts` exports `TuningRecord`, which mirrors the JSON document without `version`, and `DecisionLine` (`kind`, `at`, `answered?`, `miss?`, `ms?`). `store/tuning-file.ts` defines its own document type with the same shape, since `store/` may not import `policy/`. A type-level test asserts that each type can be assigned to the other. A shared type in `shared/` was considered and rejected: `shared/` holds rules used by several modules, not one store's schema.

**D2. Decisions are counted by time, not by position.** A decision is a `main` or `worker` line. "After a change" means `at` strictly greater than the change's `at`. Counting by `at` keeps working across ledger rotation and with several processes, where positions shift. A turn that started before a change and settled after it has an earlier `at`, so it is excluded, which is correct: it ran with the old timeout. If the ledger is deleted, counts restart from zero. Cooldowns and blocks then last longer, which errs on the safe side.

**D3. The step, in order** (matches `docs/workflow.md` §5):
1. `off` → no change.
2. **Superseded:** the record has a tuned value whose `base` differs from the untuned value → drop the value, the pending change and the block. Record a `superseded` history entry. The current value is now the untuned one. This counts as a change for the cooldown (my call: after a config edit, wait 40 decisions before tuning again).
3. **Pending evaluation:** when at least 40 decisions follow the pending change, take the first 40 of them. With at least 20 asked, and a timeout share strictly above the stored `before` share, revert: the value goes back to `from` (dropped entirely if `from` equals the base), a `revert` history entry is added, and a block is set at the reverted `to`. Otherwise the change is kept and the pending record is cleared. With fewer than 40 decisions after it, stop.
4. **Cooldown:** fewer than 40 decisions after the latest history entry → stop.
5. **Fire:** the window is the latest 40 decisions, all of them after the latest history entry. With at least 20 asked and `timeout / asked > 0.10`, compute the new value.
6. **New value:** `max(current + 200, ceil100(p90 × 1.25))`, clamped to 300–5000. p90 is nearest-rank over the `ms` of answered lines in the window; with no answered line, only `current + 200` applies. While a block is active and the new value is at or above the blocked value, use `blocked − 100`. If that is not above `current`, there is no change. A new value equal to `current` (at the ceiling) is no change.
7. **Apply:** set `timeoutMs = { value, base }`, `pending = { from: current, to, at: now, before: { asked, timeouts } }` from the window, and add a `rule` history entry.

Shares are kept as integer counts and compared by cross-multiplying (`timeouts × 10 > asked` for the rule, `a.timeouts × b.asked > b.timeouts × a.asked` for the revert), so no float rounding decides anything. Decisions are sorted by `at`, then `kind`, `session`, `answered`, `miss` and `ms`, so the result never depends on input order, even with equal `at`. Order inside step 6: compute, clamp, apply the block, then compare with `current`.

The result is `{ record, events }`, with `events` from `superseded`, `kept`, `reverted` and `applied`, each carrying `from` and `to`, so the host can show one line per event. Steps 3 and 5 may both happen in one call (kept, then applied), as the workflow diagram shows.

**D4. Block.** A block is `{ value, at }`. It is active while fewer than 200 decisions follow its `at`. Both an automatic revert and an undo set it. Undo sets it as my call, an extension of the operator's revert decision: without it, the rule re-applies the step the operator just undid 40 decisions later. The final gate confirms it. Reset clears it, since reset means "back to my settings, start over".

**D5a. Untuned value out of range.** The untuned value always comes from a validated config or the default, so it is within 300–5000. If it is not, the step and reset neither fire nor write a history entry, so the record stays valid for the store.

**D5. Undo, reset, off.**
- `undoTuning(record, now)`: needs a tuned value; the base comes from the record. It moves the value back to the `from` of the latest `rule` entry whose `to` equals the current tuned value (so undo works after a revert, and twice in a row), or drops the value when there is none or the target equals the base. It clears pending, sets the block at the value it undid and adds an `undo` entry. With nothing tuned, it reports `nothing` with the record unchanged.
- `resetTuning(record, untuned, now)`: drops the value, pending and block, adds a `reset` entry when a value was tuned, and keeps `off`.
- `setTuningOff(record, off)`: flips the flag with no history entry, and keeps everything else. While off, the step stops before evaluating a pending change, so the tuned value stays until reset or undo.

**D6. History.** Each entry is `{ at, parameter: "timeoutMs", from, to, cause }`, with cause `rule`, `revert`, `undo`, `reset` or `superseded`. Only the latest 50 are kept. The policy trims, and the store rejects more than 50. The cooldown reads the latest entry's `at`, so it holds after `pending` is cleared.

**D7. Resolver shape.** The tuning layer becomes `{ timeoutMs?: { value?: unknown; base?: unknown } }`. The tuned value applies only when both are integers from 300 to 5000 and `base` equals the untuned value (`config.classifier.timeoutMs ?? default`). A structural check like today's protects the resolver from a hand-edited file even after store validation. The current `classifier`-nested shape has no caller, so it is replaced, not kept beside the new one.

**D8. `tuning.json` store.** It copies the `state.json` behaviour: `readTuning(dir)` returns `ok`, `missing`, `malformed` (with issues, no fields salvaged) or `unreadable` (with the error code). `updateTuning(dir, mutate)` reads, mutates, validates and writes atomically through `writeFileAtomic`. A malformed file is first moved to `tuning.json.bad` (mode `0600`). An unreadable file makes it refuse. An invalid result is refused, and the file is left as it was. A missing or malformed file reads as an empty record, so defaults apply and nothing is tuned. Last writer wins across processes. Both compute from ledger lines of the same age, so concurrent results agree in practice.

## Risks / Trade-offs

- [Lines written out of `at` order by concurrent processes] → Windows select by `at` and sort, so the order of lines in the file does not matter.
- [A revert based on a 20-request sample is noisy] → Revert needs a strictly higher share, and only a raise is ever reverted, so the worst case is a wasted step back to the old value, which is visible.
- [Ledger deleted mid-evaluation] → The pending change waits for 40 new decisions. The `before` counts live in the record, so the comparison still works.
- [Hand-edited `tuning.json` with valid shape but odd values] → Range checks in the store and the resolver keep the effective value inside 300–5000.
- [Superseded resets cooldown] → After a config edit, tuning waits 40 decisions, which is deliberate.

## Migration Plan

None. No file exists yet, and the resolver's tuning argument has no caller. Rollback is a revert of the commit.

## Open Questions

None.
