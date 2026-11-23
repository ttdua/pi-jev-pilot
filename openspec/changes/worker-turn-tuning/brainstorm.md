## Design Summary

**Intent.** The worker turn floors that #103 shipped (`medium` 40, `long` 100, `very_long` 200, `BAND_FLOOR` in `src/policy/worker/turns.ts`) are a guess taken from overall `toolUses` percentiles. This change makes them follow measured use: collect how many turns workers in each band really use, show it in `/jev tune`, and once a band has enough data, let tuning move that band's floor up or down within safety bounds. It works like the existing `timeoutMs` tuning.

**Current state.** #103 is merged. Worker lines now carry `turnsP`, `requestedTurns`, `turnFloor`, `turnsUsed` and `turnPhase` (living specs `worker-ledger` "Worker turn fields" and "Worker turn use", `decision-ledger`). The local ledger (1274 worker lines on 2026-11-23) holds none of these fields yet. The feature therefore starts by collecting data and suggests or changes nothing until a band has enough samples.

**Goals**
- `/jev tune` shows, per band, observed turn use from ledger lines only, with no network call: runs counted, p90 and p95 of `turnsUsed`, suggested floor, `exhausted` and `warned` counts, and the mean `turnsUsed / turnFloor`.
- Tuning changes a band's floor from that data at the same moment the `timeoutMs` step runs (`agent_settled` of a main run), with guards equivalent to those `timeoutMs` already has.
- With too few samples, tuning off, or a missing or bad `tuning.json`, the static floors apply.

**Non-goals**
- No per-mode floors: one set serves `budget`, `standard` and `premium`. Modes change the model, not how long the work is, and splitting would cut each sample by three.
- No new `config.json` key for floors in this change. The base of tuning is the static floors. A config override can come later.
- No change to how Jev is asked `turns` or to the cumulative ≥ 0.5 band rule.

**Anti-goals** (failure even if it works)
- A floor lowered on thin or capped data so workers run out of turns mid-task.
- Tuning that lowers a launch's own requested `maxTurns`. A floor only ever raises a limit, as today.
- A second, parallel tuning mechanism with its own file and commands.

**Behaviour agreed**
1. **Band of a run.** A run belongs to the band the floor rule picks from its `turnsP` (cumulative from the longest band down, first to reach 0.5). Only runs with `turnsP` and `turnsUsed` count. `short` runs have no floor and are left out. Runs whose own `maxTurns` was already above the floor (no `turnFloor` written) still count: their use is real and not capped by the floor.
2. **When a band updates.** Each band updates independently, once at least 200 counted runs of that band follow its latest change. A sparse band keeps its current floor until it gets there.
3. **New value.** p95 of `turnsUsed` × 1.25, rounded up to a multiple of 10. If more than 5% of the band's window ended `exhausted`, the value is raised one step whatever the percentile says, because an exhausted run's `turnsUsed` understates what it needed.
4. **Safety bounds.** One change moves a floor by at most ±25% of its current value. Hard ranges: `medium` 20–80, `long` 50–200, `very_long` 100–400. Floors stay strictly ordered `medium` < `long` < `very_long`.
5. **Evaluation and revert.** After a change, the next 200 runs of that band are judged. If their `exhausted` share is higher than before the change, the floor goes back and the same move is held back for a while, as `timeoutMs` reverts and blocks.
6. **Operator controls.** `/jev tune` reports the floors (tuned from, or not tuned) with the per-band signals. `/jev tune undo` undoes the latest change of any parameter, `reset` clears every tuned value, and `off` stops all tuning. A bad `tuning.json` falls back to the static floors.

**Specified requirements this change alters** (stated explicitly)
- `tuning-rules` "Pure tuning step": "The only parameter it may change is `timeoutMs`". The step will also change the three band floors.
- `tuning-rules` "Undo", "Reset", "Bounded history": these are written for `timeoutMs` only and will cover the floors too.
- `tuning-file` "Tuning file content" and "Tuning file values": `version` `1`, unknown keys rejected, `parameter` must be `timeoutMs`. The file gains the floor parameters.
- `tune-command` "Tune report", "Tune undo", "Tune reset": report lines and messages name only `timeoutMs`.
- `tuning-host` "Tuned value reaches every reader": worker routing will also read tuned floors.
- `worker-decision`: the floor written comes from tuning when a tuned value applies, else from the static table.
- `tuning-signals` "Signals per mode": the new per-band signal is computed per band rather than per mode, over its own window.

## Alternatives Considered

### Alternative A: Extend the existing tuning to several parameters
- **Approach**: The one `tuning.json` and the one pure step gain the three band floors next to `timeoutMs`, each with its own tuned value, pending change and block, and a shared history whose entries name their parameter. The step runs the `timeoutMs` rule as today, then the floor rule per band. `/jev tune` commands act on all parameters.
- **Pros**: reuses the proven guards (cooldown, judging, revert, block, undo, reset, off, bad-file recovery); one file and one command set; one `off` switch.
- **Cons**: alters several specified requirements across four tuning specs; needs a file version change and reading older files.
- **Why not chosen**: chosen.

### Alternative B: A separate file and rules for turns
- **Approach**: A new `turn-tuning.json` with its own rules and step, running beside the `timeoutMs` tuning.
- **Pros**: leaves the working tuning specs untouched.
- **Cons**: duplicates the whole guard mechanism; `/jev tune undo`, `reset` and `off` must choose between two files; two sources of truth for one switch.
- **Why not chosen**: more code and more ways to disagree, for no behaviour the user asked for.

### Alternative C: Derive floors from the ledger at each launch, stored nowhere
- **Approach**: Every worker launch computes the floor from recent ledger lines.
- **Pros**: simplest; no file or migration.
- **Cons**: no state means no cooldown, no evaluation or revert, no undo and no per-change ±25% bound; floors could jitter launch to launch.
- **Why not chosen**: contradicts the user's requirement of safety bounds on changes.

## Agreed Approach

Alternative A. The user asked for floors to follow measured data "like the current tune": update once enough data has been collected (200 runs), allow moves in both directions, and keep safety thresholds. Extending the existing tuning gives exactly those guards with one file and one `/jev tune` surface. B duplicates them and C cannot provide them.

## Key Decisions

- Scope: signal and apply ship together in this change (user).
- Update cadence: once per 200 new counted runs of a band since its latest change; no update before that (user: "collect until there is enough, then update").
- Direction: floors may go down as well as up, within safety bounds (user).
- New value: p95 × 1.25, rounded up to 10, plus a forced step up when the `exhausted` share passes 5% (proposed, accepted).
- Bounds: ±25% per change, per-band hard ranges 20–80, 50–200 and 100–400, strict order between bands (proposed, accepted).
- Revert when the `exhausted` share in the next 200 band runs exceeds the share before the change, followed by a block (proposed, accepted).
- One set of floors for all modes (proposed, accepted).
- Band of a run from the cumulative ≥ 0.5 rule; `short` excluded; runs not raised by the floor included (proposed, accepted).
- The base is the static floors; no config key for floors in this change (proposed, accepted).

## Open Questions

Left to design; none needs the user:
- The size of the forced step up on an `exhausted` share above 5% (for example the ±25% bound itself).
- Block length and direction semantics for a reverted floor, which can now move down as well as up.
- What undo targets when the latest history entry belongs to another parameter, and the message texts for floor changes.
- How a `version` 1 `tuning.json` is read and rewritten.
- The window for the signal shown in `/jev tune` (latest 200 counted runs per band is the natural default) and the minimum shown before a suggested floor appears.
