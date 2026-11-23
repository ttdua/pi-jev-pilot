# 0012: Tuned turn floors

**Status:** Accepted, 2026-11-23. Amends [ADR 0005](0005-bounded-auto-tuning.md) for turn floors.

## Context

The turn floors (`medium` 40, `long` 100, `very_long` 200) were a guess from overall `toolUses` percentiles. Worker lines now record `turnsP`, `turnsUsed` and `turnPhase`, so the floors can follow measured use in each band. Reusing `/jev tune` gives the same guards as `timeoutMs`.

## Decision

Tuning moves `timeoutMs` and the three band floors. Each band has its own cooldown, pending change and block.

- **Counted runs:** a worker line with `turnsP`, a band other than `short`, an integer `turnsUsed` and a status other than `aborted`. Aborted runs are excluded, since the operator cut them short.
- **Rule:** after 200 counted runs of a band, `wanted = ceil10(p95 × 1.25)` (p95 by nearest rank). When more than 5% of runs ended `exhausted`, the step is forced to the full upward bound.
- **Bounds:** each change moves at least 10 and at most ±25%, within the hard ranges (`medium` 20–80, `long` 50–200, `very_long` 100–400). Bands stay at least 10 apart, counting a pending neighbour at its worst value.
- **Decreases apply automatically.** This amends ADR 0005, which allowed decreases only after two windows or a question at idle.
- **One applied change per step.** The step first judges pending changes. Any revert ends the step. Otherwise the timeout rule runs, then the bands in order `medium`, `long`, `very_long`.
- **Cooldown per parameter:** a band counts its runs after the later of its latest change and its latest history entry. A band needs 200 counted runs; `timeoutMs` keeps its 40-decision cooldown. A floor change never holds back the timeout rule, or the reverse.
- **Judging and revert:** the first 200 runs after a change are judged. A change is reverted when their `exhausted` share is strictly higher than before it. A revert blocks the same move for 400 counted runs.
- **Undo and reset** act across parameters. Undo targets the most recent change; reset clears every tuned value.

The thresholds (p95 × 1.25, 5%, ±25%, 200 runs) are first estimates. Review them once 200 runs exist per band.

## Consequences

- Floors can move down as well as up, so a bad decrease can make long tasks run out of turns. The bounds, the forced step on `exhausted` runs and the revert limit that damage.
- `tuning.json` gains `version` 2 with `turnFloors`, written once floor data exists, including floor history; `/jev tune reset` keeps `version` 2 while floor history remains. An older package reads a `version` 2 file as malformed, so tuned values are lost until the operator reconfigures; the built-in floors apply.
- ADR 0005's "one parameter and one step at a time" becomes "one applied change per step".
- `very_long` may never reach 200 counted runs. Its floor then stays at the built-in value, and `/jev tune` shows `needs 200 runs`.
