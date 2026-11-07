## Why

ADR 0005 wants tuning that applies itself within limits, so the operator has nothing to remember. WG-18 mixes pure rules with host wiring. Building the rules and `tuning.json` first lets fire, cooldown, range, revert and undo be table-tested alone, and leaves the host change (`agent_settled`, `/jev tune`, change line, observed signals) with wiring only.

## What Changes

- Add pure tuning rules over plain ledger lines: when the `timeoutMs` rule fires, the new value, the cooldown, the evaluation of a pending change (keep or revert), undo, reset and the on/off switch.
- Add the `tuning.json` store: read, validate, atomic update, malformed and unreadable handling like `state.json`.
- Change how the settings resolver applies a tuned value.

**What counts against the timeout**
- From: the rule fires when more than 10% of at least 20 asked requests went unanswered.
- To: only requests that ended with `miss: timeout` count; `error` and `schema` misses do not.
- Reason: operator decision 2026-11-07; a longer timeout cannot fix them, and counting them tunes on noise.
- Impact: non-breaking; nothing tunes yet.

**After a revert**
- From: the rule may fire again after the ordinary 40-decision cooldown.
- To: for 200 decisions after an automatic revert or an undo, the rule may not raise the value to the reverted value or higher.
- Reason: operator decision 2026-11-07, to stop the value swinging back and forth.
- Impact: non-breaking.

**Tuned value versus config**
- From: a tuned `timeoutMs` always wins over `state.json` and `config.json`.
- To: a tuned value records the base value it was tuned from, and applies only while the untuned value (config or default) still equals that base. Otherwise the operator's value applies.
- Reason: operator decision 2026-11-07; an edit to `config.json` must not be silently overridden.
- Impact: changes the `settings-resolution` tuning layer's shape; its only caller passes no tuning yet.

Docs updated: `docs/domain-model.md` (tuning rules, the timeout-only signal, the block after a revert or undo, base value), `docs/configuration.md` (`tuning.json` content, missing and malformed cases, precedence with base), `docs/usage-guide.md` (config edits win over tuning), `docs/workflow.md` (auto-tuning flow), `docs/roadmap.md` (WG-18 split in two changes).

## Capabilities

### New Capabilities
- `tuning-rules`: the pure `timeoutMs` rule, the cooldown, the evaluation of a pending change, the block after a revert or undo, undo, reset and the off switch, as functions of the tuning record and plain ledger lines.
- `tuning-file`: the content of `tuning.json`, its validation, and atomic updates with missing, malformed and unreadable handling.

### Modified Capabilities
- `settings-resolution`: the tuning layer carries a value with its base, and the tuned value applies only while the untuned value equals the base.

## Impact

- New code: `src/policy/tuning.ts`, `src/store/tuning-file.ts`, with unit tests.
- Changed code: `src/store/settings.ts` (tuning layer shape) and its tests.
- No Pi wiring, no change to `config.json`, `state.json` or the ledger, no new dependency. No Jev call: the rules only read the outcomes of earlier calls from the ledger.
- Nothing calls the new code until the WG-18 host change.
