## Design Summary

WG-18 (auto-tuning, G3 phase 1) is split in two changes. This one, `wg-18-tuning-policy`, builds the parts that need no running Pi:

1. **Pure tuning rules** (`src/policy/tuning.ts`) over plain ledger lines. They decide whether the `timeoutMs` rule fires, the new value, whether the cooldown has passed, and whether a pending change should be kept or reverted.
2. **The tuning file** (`src/store/tuning-file.ts`): `tuning.json` holds the applied value, the change under evaluation, the on/off flag and the history. It is written atomically and handles a malformed or unreadable file.

The second change (host) wires `agent_settled`, `/jev tune` and its subcommands, the change line and the per-mode observed signals. Nothing calls the new code until then.

**Why:** ADR 0005 wants tuning that applies itself within limits, so the operator has nothing to remember. Building the rules and the file first lets them be table-tested alone. The roadmap's "done when" (fire, cooldown, range, revert, undo; nothing outside the allowlist; `config.json` untouched) is mostly met by this half.

**Goals**
- `timeoutMs` is the only automatically tuned parameter, one step at a time, in the range 300–5000.
- Every rule is deterministic and replayable from ledger lines alone.
- The operator's own config edits are never silently overridden.

**Non-goals**
- Pi wiring, commands, display lines, observed signals (host change).
- Tuning any other parameter, including the risk floor, effort ceiling, expert rules and tool threshold.

**Anti-goals**
- Tuning on noise: raising the timeout because of errors a longer timeout cannot fix.
- Oscillation: a value that swings back and forth after each revert.
- Writing to `config.json`.

### Behaviour agreed with the operator

- **Only timeouts count.** The rule fires when more than 10% of at least 20 asked requests ended with `miss: timeout`. `error` and `schema` misses do not count, since a longer timeout does not fix them. Docs are reworded from "unanswered" to "timed out".
- **No climb back after a revert.** After an automatic revert, the rule may not raise the value to the reverted value or higher for 200 decisions. Lower raises stay possible after the ordinary cooldown.
- **Config edits win.** Each tuned value records the base value it was tuned from. When the untuned value (config or default) no longer equals that base, the tuned value is ignored and the operator's value applies.

### Defaults proposed and not objected to

- A decision is a `main` or `worker` ledger line; `correction` lines do not count. A request was asked when the line is `answered` or has a `miss`.
- The fire window is the latest 40 decisions, all after the last change, with at least 20 asked. All modes are pooled, since the transport does not depend on mode.
- p90 is nearest-rank over answered `ms`.
- The change record keeps the before-window timeout share, so revert can still be judged if the ledger is deleted. Revert only when the after share is strictly higher. With fewer than 20 asked in the after window, the change is kept.
- A revert or an undo is also a change, so the cooldown restarts.
- `tuning.json` holds the `/jev tune off` flag. History keeps the latest 50 entries. With two Pi processes, the last writer wins.

## Alternatives Considered

### Alternative A: Tuning stored in `state.json`
- **Approach**: add a `tuning` section to `state.json` next to switches and mode.
- **Pros**: one fewer file; reuses the existing state store.
- **Cons**: mixes operator choices with automatic changes; `/jev reset` would wipe tuning history; contradicts ADR 0005 ("stored separately") and `docs/configuration.md`.
- **Why not chosen**: the docs already promise a separate file, and resets must stay independent.

### Alternative B: Policy reads the ledger itself
- **Approach**: `policy/tuning.ts` calls `readLedger` and the tuning store directly.
- **Pros**: fewer arguments at the call site.
- **Cons**: breaks the invariant that `policy/` is pure; rules can no longer be table-tested without files.
- **Why not chosen**: the architecture forbids I/O in `policy/`.

### Alternative C: Everything in one change
- **Approach**: rules, file, host wiring and `/jev tune` together.
- **Pros**: the feature ships whole.
- **Cons**: a large review mixing pure rules with host seams; the repository's pattern (WG-11 policy and host) splits these.
- **Why not chosen**: the split keeps each review small and lets the rules be fixed before wiring.

## Agreed Approach

Pure rules in `policy/` over plain ledger lines, plus a separate `tuning.json` store in `store/`, as laid out in `docs/architecture.md`. The host change follows. The three operator answers above shape the rules: timeouts only, no climb back for 200 decisions after a revert, and a recorded base so config edits win.

## Key Decisions

- Only `miss: timeout` counts toward the rule and the revert comparison (operator, 2026-11-07).
- After an automatic revert, no raise to the reverted value or higher for 200 decisions (operator, 2026-11-07).
- A tuned value applies only while the untuned value equals its recorded base (operator, 2026-11-07). This changes the settings resolver's precedence rule.
- Split WG-18 into `wg-18-tuning-policy` and a host change.

## Open Questions

- None for this change. The observed signals' exact definitions are settled in the host change.
