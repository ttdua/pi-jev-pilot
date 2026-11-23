## Context

Tuning today (`src/policy/tuning/rules.ts`, `src/store/tuning-file.ts`, `src/host/tuning/`) moves one parameter, `timeoutMs`, from main and worker decisions. It keeps one `pending`, one `block` and a shared history in `tuning.json` `version` 1, and starts its cooldown from the latest history entry of any cause. The band floors live as a constant `BAND_FLOOR` in `src/policy/worker/turns.ts` and reach the route through `turnFloor(answer)` in `src/policy/worker/route.ts`. Settings resolution (`src/store/settings-sections.ts`) applies a tuned value only while its `base` equals the untuned value.

Layer rules (`tests/support/import-graph.ts`, `.oxlintrc.json`): `policy` imports only `policy` and `shared`; `store` imports only `store` and `shared`; other capabilities are reached through their `index.ts`. So `store` cannot read `BAND_FLOOR` from `policy/worker`.

Brainstorm.md holds the agreed behaviour. This document covers how.

## Goals / Non-Goals

**Goals:**
- One step function tunes `timeoutMs` and three band floors, each with its own cooldown, pending change and block, applying at most one change per call.
- Floors reach worker routing through the settings snapshot, the way a tuned `timeoutMs` reaches the classifier.
- Per-band turn signals in `/jev tune`, computed by the same functions the floor rule uses, so the report shows what the rule would do.

**Non-Goals:**
- No new config key, ledger field or Jev question.
- No per-mode floors.
- No general parameter registry. Exactly two parameter kinds exist (`timeoutMs`, a band floor), and code names them directly.

## Decisions

### D1. Built-in floors and ranges move to `src/shared/turn-floors.ts`
`FLOOR_BANDS` (`medium`, `long`, `very_long`), `BUILTIN_FLOORS` (40, 100, 200) and `FLOOR_RANGES` (20–80, 50–200, 100–400) live in `shared/`, so that `store` (validation, resolution) and `policy` (route, rules) read one source. `policy/worker/turns.ts` re-exports nothing new and keeps `TURN_BANDS`.
Alternative: duplicate the constants in `store/defaults.ts`. Rejected: two copies of a safety range drift.

### D2. Band of a run reuses the floor rule
`policy/worker/turns.ts` gains `turnBand(probabilities)`, which returns the band whose cumulative probability first reaches .5 walking down from `very_long`, or `undefined`. `turnFloor(answer, floors)` becomes `floors[turnBand(...)]`. Tuning reads the band through `policy/worker/index.ts`. A counted run is a worker line with `turnsP`, a non-`short` band from `turnBand`, an integer `turnsUsed` and a `status` other than `aborted`. Aborted runs are excluded because the operator cut them short, and their low `turnsUsed` would pull p95 down. `stopped` and `error` runs stay: they are the runs a floor exists for.

### D3. Floors are passed in, not read from a constant
`RouteInput` gains `floors: BandFloors` and `turnFloor` takes it. The host builds it from `settings.turnFloors`. `Settings` gains `turnFloors: BandFloors`, resolved per band: the tuned value when its `base` equals the built-in floor and both values are in the band's range, else the built-in floor. When the resolved floors are not strictly ordered `medium < long < very_long`, every tuned floor is ignored and the built-in floors apply. The rules keep the order themselves (D6, D9), so this case means a hand-edited file. Falling back as a whole is simpler and safer than guessing which band is wrong.

### D4. `tuning.json` version 2 with a `turnFloors` object
```
turnFloors?: { medium?: FloorState; long?: FloorState; very_long?: FloorState }
FloorState = { changedAt; tuned?: { value, base }; pending?: { from, to, at, before: { runs, exhausted } }; block?: { value, at } }
```
The top-level `timeoutMs`, `pending` and `block` keep their meaning, so a `version` 1 file reads unchanged as the timeout state. The reader accepts `version` 1 (no `turnFloors` key and no floor history entries allowed) and 2. A write emits `version` 2 only when the record holds floor state or floor history, else `version` 1. An older package therefore keeps reading files that never had a floor tuned.
`changedAt` records the time of the band's latest change (rule, revert, undo, superseded). The band's cooldown counts from the later of `changedAt` and its latest history entry, so trimming the shared 50-entry history cannot reset a sparse band's cooldown. History `parameter` becomes one of `timeoutMs`, `turnFloor.medium`, `turnFloor.long`, `turnFloor.very_long`. `from` and `to` are validated against that parameter's range, by a custom entry validator in the style of `beforeValidator`. A `FloorState` holding only `changedAt` is kept (it carries the cooldown after a supersede or a revert to base). Only reset drops band state entirely, and an empty `turnFloors` is never written.
Alternative: a generic `params` map that also holds `timeoutMs`. Rejected: it would rewrite the stable `timeoutMs` shape for no gain.

### D5. Step order and the one-change limit
`stepTuning` keeps its signature and adds the floors:
1. With `off`, or an untuned timeout out of range: unchanged, no events (as today).
2. Supersede, for `timeoutMs` (config base) and each band (built-in base).
3. Judge every pending change (timeout, then bands in order). Each yields `kept` or `reverted`.
4. With any `reverted`, stop: no `applied` in the same call.
5. Otherwise try the timeout rule. If it applies nothing, try the bands in order `medium`, `long`, `very_long`. Stop at the first `applied`.

`TuningEvent` gains `parameter`. Timeout behaviour is unchanged except its cooldown and window now count from the latest history entry whose `parameter` is `timeoutMs` (D7).

### D6. The floor rule, per band
Window: the latest 200 counted runs of the band, all strictly after the later of its `changedAt` and its latest history entry (`at` 0 when neither). Fewer than 200 means no change. Order and ties: by `at`, then by the line's sorted-key JSON, as `tuning-signals` does.
- `p95`: nearest rank, `values[ceil(95n/100) − 1]`, integers only.
- `wanted = ceil10(p95 × 5 / 4)`, computed as `ceil(p95 × 5 / 40) × 10`.
- Step bounds from `current`: `up = max(current + 10, floor10(current × 5 / 4))` and `down = min(current − 10, ceil10(current × 3 / 4))`. Each move is at least 10, and never more than 25% where 10 is under 25%.
- When `exhausted × 20 > runs` (more than 5%), `wanted = max(wanted, up)`: the forced step is the full upward bound.
- `value = clamp(wanted, down, up)`, then the band range, then the order, then the block (D8).
- Order: at least 10 above the lower band and 10 below the upper band. A neighbour with a pending change counts at its worst value for the order: a lower neighbour as `max(from, to)`, an upper one as `min(from, to)`. A later revert of the neighbour therefore cannot cross this band.
- No change when `value === current`.

An `applied` change sets `tuned { value, base: built-in }`, `pending { from, to, at: now, before: { runs, exhausted } }` and a `rule` history entry `turnFloor.<band>`.

### D7. Cooldown per parameter
The timeout rule's cooldown and window count decisions after the latest history entry of `timeoutMs`. A band counts its runs after the later of its `changedAt` and its latest `turnFloor.<band>` entry. A floor change therefore never holds back the timeout rule, and the reverse. This alters the `tuning-rules` Cooldown requirement ("whatever its cause" now means any cause of the same parameter). ADR 0005's "one parameter and one step at a time" becomes "one applied change per step", recorded in ADR 0012.

### D8. Judging, revert and block for floors
Once 200 counted runs follow `pending.at`, the first 200 are judged. A revert happens when their `exhausted` share is strictly above `before` (`a.exhausted × b.runs > b.exhausted × a.runs`). Otherwise the change is kept. A revert restores `from` (it removes `tuned` when `from` equals the base), adds a `revert` entry, and sets `block { value: to, at: now }`.

Because a floor moves both ways, the block's direction is read from the current value rather than stored. The block lasts 400 counted runs of the band, twice the cooldown: the cooldown starts at the same moment, so a 200-run block would expire exactly when the band may next change. While fewer than 400 counted runs follow `block.at`:
- when `block.value > current`, a value `≥ block.value` is lowered to `block.value − 10`;
- when `block.value < current`, a value `≤ block.value` is raised to `block.value + 10`.

Undo sets the same block. The timeout block is unchanged.

### D9. Undo and reset across parameters
Undo picks, among parameters whose tuned value applies (base equals today's untuned or built-in value), the one changed most recently (for a band, the later of `changedAt` and its latest entry), and runs that parameter's existing undo logic. Ties go in the order `timeoutMs`, `medium`, `long`, `very_long`. A floor undo target is first clamped by the same band order as D6, with a pending neighbour at its worst value; if the clamp leaves it at the current value, that parameter is skipped and the next most recent one is tried. A floor undo sets `changedAt`. Reset removes every parameter's `tuned`, `pending` and `block`, keeps `off`, and adds one `reset` entry per parameter that had a tuned value. Command texts:
- the undo message for `timeoutMs` keeps today's text;
- floors: `Jev tune: turnFloor.<band> <from>→<to> undone. The same change is held back for 400 <band> runs.`;
- reset: `Jev tune: back to your settings (timeoutMs <untuned>, turn floors 40/100/200).`

### D10. Signals and report
`turnSignals(lines, floors)` in `policy/tuning/turn-signals.ts` returns per band: `runs`, `p90`, `p95`, `exhausted`, `warned`, `usedOverFloor`, and either `suggested` (D6 applied to the band's latest 200 counted runs, ignoring cooldown, pending and block) or `needs: 200`. `usedOverFloor` is the mean of `turnsUsed / turnFloor` over runs with `turnFloor`, shown with two decimals, or `-` when no run has one.

The tune report adds:
- a `turnFloor:` line after `timeoutMs`;
- floor `pending` and `block` lines after the timeout ones;
- a `turn signals` block after the mode signals.

History lines gain the parameter name only for floor entries, so existing `timeoutMs` lines keep their text.

### D11. Lines shown to the operator
Change lines name the parameter.

| Event | Line |
|---|---|
| applied | `Jev tune: turnFloor.<band> <from>→<to> · /jev tune undo` |
| reverted | `Jev tune: turnFloor.<band> <from>→<to>, reverted: more runs ran out of turns · /jev tune` |
| superseded | `Jev tune: turnFloor.<band> <from>→<to>, the built-in floor changed` |

`timeoutMs` lines are unchanged. The session-start line lists each parameter with unseen entries, in first-appearance order, separated by `, `, with one total count: `Jev tune since your last session: timeoutMs 1500→1700, turnFloor.long 100→120 (3 changes) · /jev tune`. With only `timeoutMs`, the text is today's.

### D12. Code layout
- `policy/tuning/record.ts` (new, leaf): record types, `TUNING`, `pushHistory`, moved out of `rules.ts` so the floor modules and `rules.ts` share them without a runtime import cycle.
- `policy/tuning/floor-runs.ts` (new): counted runs, percentile, window.
- `policy/tuning/floor-rules.ts` (new): value, apply, judge, revert, block and supersede for one band.
- `policy/tuning/floor-step.ts` (new): the floor phases over the three bands and the undo target choice.
- `policy/tuning/turn-signals.ts` (new).
- `policy/tuning/rules.ts`: the orchestration in D5, undo and reset across parameters, per-parameter cooldown.
- `policy/tuning/text.ts`: lines and report.

Each new file stays under the size of today's `rules.ts`. Policy imports `turnBand` from `policy/worker/index.ts`.

## Risks / Trade-offs

- [Data arrives slowly; `very_long` may never reach 200 runs] → it keeps the built-in floor; the report shows its count and `needs 200`.
- [A decrease makes long tasks run out of turns] → ±25% per change, hard minimum per band, revert on a higher `exhausted` share, and a block on the same move.
- [Revert on a single extra `exhausted` run is sensitive] → accepted: it errs toward the previous floor, and the next attempt comes only after 200 more runs.
- [An older package reads a `version` 2 file as malformed and, on its next write, moves it to `tuning.json.bad`] → this happens only once a floor has been tuned, since files without floor data stay `version` 1. Tuned values are lost, not corrupted, and the static floors apply. Noted in the changelog.
- [History is capped at 50 across all parameters, so a sparse band's entry can be trimmed] → `changedAt` keeps its cooldown. Undo then falls back to the built-in floor, as `timeoutMs` already does.
- [`exhausted` runs understate the turns needed] → the forced step up when the `exhausted` share passes 5%.
- [Hand-edited floors out of order] → the resolver ignores every tuned floor and uses the built-in floors (D3).

## Migration Plan

No operator step. A `version` 1 `tuning.json` reads as before, and stays `version` 1 until a floor is first tuned. Rollback to an older package treats a `version` 2 file as malformed: nothing is tuned, the static floors apply, and that package's next write moves the file aside. `/jev tune reset` returns every value to the built-in or config value.

## Open Questions

None blocking. The thresholds (p95 × 1.25, 5%, ±25%, 200) are first estimates and are recorded in ADR 0012 for review once real runs exist.
