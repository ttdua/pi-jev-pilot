## Why

The worker turn floors from #103 (`medium` 40, `long` 100, `very_long` 200) are a guess from overall `toolUses` percentiles, not from runs Jev rated in each band. Worker lines now record `turnsP`, `turnsUsed` and `turnPhase`, so the floors can follow measured use. Tuning already moves `timeoutMs` with cooldown, judging, revert, undo and reset; reusing it lets the floors move up or down from data, within safety bounds, with nothing to remember.

## What Changes

- `/jev tune` shows per-band turn signals from ledger lines only: counted runs, p90 and p95 of `turnsUsed`, `exhausted` and `warned` counts, the mean `turnsUsed / turnFloor`, and the floor the rule would set.
- A new pure rule tunes each band floor once 200 counted runs of that band follow its latest change: p95 × 1.25, rounded up to 10, raised one bounded step when more than 5% of runs ended `exhausted`, limited to ±25% per change (a move is at least 10), to a hard range per band and to the band order. A change is judged on the next 200 runs and reverted, then blocked for 400 runs, when the `exhausted` share grew. Aborted runs are not counted.

**Tuning parameters**
- From: tuning changes only `timeoutMs`; the cooldown counts from the latest history entry of any parameter.
- To: tuning changes `timeoutMs` and the three band floors, at most one applied change per step; each parameter has its own cooldown, pending change and block.
- Reason: floors need the same guards; a floor change must not hold back the timeout rule.
- Impact: non-breaking for operators; `tuning.json` gains `turnFloors` and is written as `version` 2 once a floor is tuned.

**Band floors in worker routing**
- From: fixed floors 40, 100 and 200 in policy code.
- To: floors come from the settings snapshot: a tuned floor while its base equals the built-in floor, else the built-in floor. The floor stays raise-only.
- Reason: a tuned floor must reach worker routing like a tuned `timeoutMs`.
- Impact: non-breaking; with no tuning the floors are unchanged.

**Undo, reset and lines**
- From: `undo`, `reset`, change lines and the session-start line name only `timeoutMs`.
- To: `undo` acts on the parameter changed most recently; `reset` clears every parameter; lines name the parameter (`timeoutMs` or `turnFloor.<band>`).
- Reason: one command set for all tuned values.
- Impact: the `reset` message and the session-start line change text.

**Automatic decreases**
- From: ADR 0005 lets spending decreases apply only after two windows in a row or a question at idle.
- To: a lower turn floor may apply automatically, bounded by ±25%, the hard ranges and the revert on more `exhausted` runs.
- Reason: the operator asked for floors to follow data in both directions with safety bounds.
- Impact: recorded in a new ADR that amends ADR 0005 for turn floors only.

## Capabilities

### New Capabilities
- `turn-floor-rules`: pure rules that tune the band floors from worker lines: band of a run, counted runs, window and cooldown per band, the new value and its bounds, judging, revert, block and superseding.

### Modified Capabilities
- `tuning-rules`: the step covers several parameters, at most one applied change per step; cooldown, history, undo and reset become per parameter or across parameters.
- `tuning-file`: `version` 2 with `turnFloors`; history `parameter` and value ranges per parameter; `version` 1 files still read.
- `tuning-signals`: adds per-band turn signals; the "signals never tune" requirement is scoped to the signal function.
- `tune-command`: report shows floors, floor pending and block lines and turn signals; `undo` and `reset` texts cover floors.
- `tuning-host`: tuned floors reach worker routing; change lines and the session-start line name the parameter.
- `settings-resolution`: the tuning layer accepts band floors with their base, in their ranges.
- `worker-decision`: the turn floor reads band floors from input instead of fixed values.

## Impact

- Code: `src/policy/tuning/` (rules, window, signals, text, new floor rules), `src/policy/worker/turns.ts` and `route.ts`, `src/store/tuning-file.ts`, `src/store/settings*.ts`, `src/store/defaults.ts`, `src/host/tuning/`, `src/host/worker/` (floors into routing), `src/host/platform/readiness.ts`.
- Tests: `tests/policy/tuning/`, `tests/policy/worker/turns.test.ts` and `route.test.ts`, `tests/store/tuning-file.test.ts`, `tests/store/settings*.test.ts`, `tests/host/tuning/`, `tests/host/tuning-host.test.ts`, `tests/host/worker-routing.test.ts`.
- Docs: `docs/configuration.md`, `docs/usage-guide.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/architecture.md`, `docs/roadmap.md`, `docs/decisions/README.md`, new `docs/decisions/0012-tuned-turn-floors.md`.
- No dependency, network call, config key or ledger field is added. An older package version reads a `version` 2 `tuning.json` as malformed and falls back to nothing tuned.
