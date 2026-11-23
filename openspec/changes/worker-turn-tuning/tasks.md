## 1. Shared floor table and floors as route input

Blocked by: none

- [x] 1.1 Add `src/shared/turn-floors.ts` with `FLOOR_BANDS`, `BUILTIN_FLOORS` (40/100/200), `FLOOR_RANGES` (20–80, 50–200, 100–400) and the `BandFloors` type; test in `tests/shared/turn-floors.test.ts` that the ranges contain the built-in floors and are ordered (spec `turn-floor-rules` "Built-in floors and ranges")
- [x] 1.2 In `src/policy/worker/turns.ts`, add `turnBand(probabilities)` (cumulative ≥ .5 from `very_long` down, 1e-9 tolerance), make `turnFloor(answer, floors)` return `floors[band]`, and drop `BAND_FLOOR` in favour of the shared table; export `turnBand` from `src/policy/worker/index.ts`; keep every existing case in `tests/policy/worker/turns.test.ts` green with `BUILTIN_FLOORS`, and add "Tuned floors passed in" (spec `worker-decision` "Turn floor")
- [x] 1.3 Add `floors: BandFloors` to `RouteInput` in `src/policy/worker/route.ts` and pass it to `turnFloor` in `withTurns`; pass `BUILTIN_FLOORS` from every caller: `src/host/worker/route.ts`, `scripts/replay/report-route.ts`, `scripts/replay/compare.ts`, and the fixtures in `tests/policy/worker/route.test.ts`, `route-pin.test.ts` and `tests/replay/report-route.test.ts`

## 2. Settings resolve tuned floors

Blocked by: 1, 3

- [x] 2.1 Extend `Tuning` in `src/store/settings.ts` with `turnFloors` (per band `tuned { value, base }`, unknown values) and add `turnFloors: BandFloors` to `Settings`; add `resolveTurnFloors` in `src/store/settings-sections.ts`: a tuned value applies when integer, in its band range, base equal to the built-in floor, and only when all resolved floors stay strictly ordered, else every band falls back to built-in
- [x] 2.2 Tests in `tests/store/settings-sections.test.ts` and `tests/store/settings.test.ts` for every `settings-resolution` "Tuned turn floors" scenario and the unchanged `timeoutMs` scenarios; update `tests/store/settings-pin.test.ts` key order
- [x] 2.3 In `src/host/worker/route.ts`, pass `floors: settings.turnFloors` to `routeLaunch`; host tests in `tests/host/worker-routing.test.ts` for `tuning-host` "Tuned floors reach worker routing" (tuned 120 written, tuned 80 under a limit of 90 writes nothing, truncated `tuning.json` gives 100, Jev timeout writes nothing), using the loopback Jev fixture

## 3. Tuning file version 2

Blocked by: 1

- [x] 3.1 In `src/store/tuning-file.ts`, add the `turnFloors` document type (per band `changedAt`, optional `tuned`, `pending` with `before { runs, exhausted }`, `block`), the history `parameter` union, and validators: per-band ranges from the shared table, `exhausted ≤ runs`, entry `from`/`to` checked against the entry's parameter range, `version` 1 or 2, `turnFloors` and floor history entries only in `version` 2
- [x] 3.2 Write `version` 2 only when the record holds `turnFloors` or a floor history entry, else `version` 1; keep the read, recovery and atomic write paths unchanged
- [x] 3.3 Tests in `tests/store/tuning-file.test.ts` for every new and modified `tuning-file` scenario (floor state read, floors or floor history in a version 1 file, written as 2, kept at 1, floor and history range problems, more exhausted than runs, unknown version), keeping the existing ones green

## 4. Pure floor rules

Blocked by: 1, 3

- [x] 4.0 Move the tuning record types (`TuningRecord`, `HistoryEntry`, `TuningEvent`, `TuningCause`, new `TuningParameter` and `FloorState`), `TUNING` and `pushHistory` from `src/policy/tuning/rules.ts` into a leaf module `src/policy/tuning/record.ts`, re-exported unchanged, so the floor rules and `rules.ts` share them without an import cycle
- [x] 4.1 Add `src/policy/tuning/floor-runs.ts`: counted runs of a band (worker line with `turnsP`, band from `turnBand`, integer `turnsUsed`, `status` not `aborted`), order by `at` then key-sorted JSON (reuse the comparator in `signals.ts` by moving it to a shared policy helper), nearest-rank percentile, and the window after a time; tests in `tests/policy/tuning/floor-runs.test.ts` for "Band of a run" and the order scenarios
- [x] 4.2 Add `src/policy/tuning/floor-rules.ts` for one band: `nextFloor` (wanted, exhausted push, up/down, range, band order with pending neighbours at their worst value, block in both directions), `applyFloor`, `judgeFloor`, `revertFloor`, `supersedeFloor`, each setting `changedAt` as specified, cooldown from the later of `changedAt` and the band's latest history entry, block over 400 runs
- [x] 4.3 Tests in `tests/policy/tuning/floor-rules.test.ts`: one test per `turn-floor-rules` scenario (new value table, band order, apply, judge, revert, block, supersede, trimmed history), recomputing each number from the spec

## 5. Multi-parameter step, undo and reset

Blocked by: 4

- [x] 5.1 In `src/policy/tuning/rules.ts`, add `parameter: "timeoutMs"` to every timeout event and scope the timeout cooldown, window, judging and block to `timeoutMs` history entries
- [x] 5.2 Rewrite `stepTuning` as the four phases of `tuning-rules` "Step order across parameters": supersede all, judge all, stop on any revert, then timeout rule, then bands in order, at most one `applied`; keep the `off` and out-of-range guards
- [x] 5.3 Make `undoTuning` pick the most recent applying parameter (band recency is the later of `changedAt` and its latest entry), clamp a floor target by the band order, skip a parameter whose clamped target equals its value, and set the floor block and `changedAt`; make `resetTuning` clear every parameter and drop band state, one `reset` entry per tuned parameter in fixed order
- [x] 5.4 Tests in `tests/policy/tuning/rules.test.ts` for every new and modified `tuning-rules` scenario and the `turn-floor-rules` "Floors follow the step order and off" scenarios, keeping all existing timeout tests green unchanged except where a scenario changed

## 6. Turn signals

Blocked by: 4, 5

- [ ] 6.1 Add `turnSignals(lines, floors)` in `src/policy/tuning/turn-signals.ts` using `floor-runs.ts` and `nextFloor` with no block; export it and `TurnSignal` from `src/policy/tuning/index.ts`
- [ ] 6.2 Tests in `tests/policy/tuning/turn-signals.test.ts` for every `tuning-signals` "Turn signals per band" and "Turn signal order" scenario, plus input-unchanged

## 7. Texts, report and host

Blocked by: 2, 5, 6

- [ ] 7.1 In `src/policy/tuning/text.ts`, add parameter-aware change lines, the multi-parameter session-start line, the floor undo message, the new reset message, the `turnFloor:` line, floor pending and block lines, floor history lines and the turn signal block; extend `TuneView`; tests in `tests/policy/tuning/text.test.ts` with the exact texts from `tuning-host` and `tune-command`
- [ ] 7.2 In `src/host/tuning/command.ts`, build the floor parts of `TuneView` from the snapshot (effective floors, tuned-from only while the config is valid, floor pending and block from the record with counted runs), compute turn signals, and route undo and reset through the new transitions (reset writes when any band state exists); tests in `tests/host/tuning/command.test.ts` for every `tune-command` scenario
- [ ] 7.3 Check `src/host/tuning/step.ts` and `seen.ts` pass events and history through unchanged; tests in `tests/host/tuning/step.test.ts`, `seen.test.ts` and `tests/host/tuning-host.test.ts` for the floor applied, reverted and superseded lines, the several-parameter session-start line, and a settle that tunes a floor from a ledger of 200 counted `long` runs with no Jev request beyond the turn's own

## 8. ADR, docs and changelog

Blocked by: 7

- [ ] 8.1 Add `docs/decisions/0012-tuned-turn-floors.md` (amends ADR 0005 for turn floors: automatic decreases within bounds, one applied change per step, per-parameter cooldown, the thresholds as first estimates) and list it in `docs/decisions/README.md`
- [ ] 8.2 Update `docs/configuration.md` (`tuning.json` version 2, `turnFloors`, history parameters), `docs/usage-guide.md` (tune report, floor lines, undo and reset), `docs/domain-model.md` (turn floor tuned from data), `docs/glossary.md` (counted run, band floor), `docs/architecture.md` (new policy files and `shared/turn-floors.ts`), `docs/roadmap.md`, `docs/workflow.md` (tuning allowlist) and `docs/scenarios.md` (floors start fixed, then tuned); add an `Unreleased` entry to `CHANGELOG.md`, noting that an older package treats a `version` 2 `tuning.json` as malformed
- [ ] 8.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`; all pass
