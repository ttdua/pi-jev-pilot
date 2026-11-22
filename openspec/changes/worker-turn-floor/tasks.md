## 1. Executor pin to v0.2.0

Blocked by: none

- [x] 1.1 Bump `devDependencies["@ttdua/pi-subagents"]` in `package.json` to `github:ttdua/pi-subagents#v0.2.0` and refresh `bun.lock` with `bun install`
- [x] 1.2 Update the executor install line to `pi install git:github.com/ttdua/pi-subagents@v0.2.0` in `README.md` and `docs/usage-guide.md` (the real-file check in `tests/release.test.ts` must pass; fixture strings in that test and dated `docs/evidence/` links stay as they are)
- [x] 1.3 Confirm `LaunchRequest["requested"]["maxTurns"]` and `LaunchAdjustment["maxTurns"]` type-check from `node_modules/@ttdua/pi-subagents`, and that `tests/host/worker-fakes.ts` `launchRequest()` still builds a valid request

## 2. Turns question and wording

Blocked by: none

- [x] 2.1 Add the `turns` wording (instruction and the four band criteria) to `docs/jev-questions.md`, and the `turns` row to the worker question table in `docs/jev-contract.md`
- [x] 2.2 Add `TURN_BANDS` to a pure module (`src/policy/worker/turns.ts`, bands only for now) and `WORKER_TURNS_QUESTION` to `src/jev/rubrics.ts`, with a test in `tests/jev/questions.test.ts` that the wording equals the docs text (spec `worker-request` "Turns question")
- [x] 2.3 Change `buildWorkerQuestions` in `src/jev/questions.ts` to take whether to ask the route questions and whether to ask `turns`; test the question sets and order, including turns-only (spec `worker-request` "Worker question set"), and the unknown-band and miss reads

## 3. Pure turn floor and route

Blocked by: 1, 2

- [ ] 3.1 Extend `LaunchRequestFacts` (`requestedMaxTurns`) and `EffectiveLaunch` (`maxTurns`, `turnsLocked`) in `src/policy/launch.ts`, add `canRaiseTurns`, and pass `requestedMaxTurns: request.requested.maxTurns` from `src/host/worker/request.ts`; test in `tests/policy/launch.test.ts` (spec `worker-decision` "Turn limit of a launch")
- [ ] 3.2 Add `turnFloor` and `turnWrite` to `src/policy/worker/turns.ts` with `BAND_FLOOR`, cumulative from the top, 1e-9 tolerance, missing bands as 0; table tests in `tests/policy/worker/turns.test.ts` for every "Turn floor" and "Turn write" scenario
- [ ] 3.3 Change `LaunchKind` in `src/policy/worker/route.ts` to `ask` with `routeQuestions`, `tierQuestion`, `turnsQuestion`, `locked`, keeping `untouched` only when the launch cannot raise; update `tests/policy/worker/route.test.ts` and the reference table in `tests/policy/worker/route-pin.test.ts` (spec "Launches left untouched")
- [ ] 3.4 In `routeLaunch`, add the turns-only route and merge the turn write into every `routed` path (thinking-only, locked, placed, nothing can run); record `turnFloor`; miss and cancel write no `maxTurns`; tests for each `worker-decision` scenario that names a turn floor, and keep every existing route test green

## 4. Ledger turn fields

Blocked by: 3

- [ ] 4.1 Add `requestedTurns`, `turnsP` and `turnFloor` to `WorkerEntry`, `LEDGER_FIELDS.worker` (after `locked`) and `workerShape` in `src/store/ledger-schema.ts` with a turns distribution domain; tests in `tests/store/ledger-schema.test.ts` and `tests/store/ledger-pin.test.ts` (spec `decision-ledger`)
- [ ] 4.2 Add the turn fields to `workerLine` in `src/policy/worker/worker-line.ts` (input gains `turnsQuestion` and `requestedTurns`); tests in `tests/policy/worker/worker-line.test.ts` for each `worker-ledger` "Worker turn fields" scenario and the qualified "Untouched recorded"

## 5. Host wiring

Blocked by: 1, 4

- [ ] 5.1 In `src/host/worker/classify.ts`, build the request from `routeQuestions` and `turnsQuestion`, so a turns-only launch asks only `turns`
- [ ] 5.2 Add `maxTurns` to `RouteWrite` in `src/host/worker/route.ts` and copy it from the route; pass `turnsQuestion` and `requestedTurns` to `workerLine` in `src/host/worker/outcomes.ts`
- [ ] 5.3 Host tests in `tests/host/worker-routing.test.ts`: `max_turns` 20 rated `long` gives an adjustment `maxTurns` 100 and the executor record's `turnBudget.maxTurns` 100; an unlimited launch, a locked `max_turns` and a limit of 120 send no `maxTurns` and no `turns` question as specified; Jev HTTP 500 and unanswered `turns` keep the limit; switch off sends nothing; a locked-model-and-thinking launch with a limit sends a turns-only request
- [ ] 5.4 Host tests in `tests/host/worker-ledger.test.ts` for the raised, asked-not-raised, turns-only and miss lines

## 6. Docs and changelog

Blocked by: 5

- [ ] 6.1 Update `README.md` (worker routing feature row: the turn floor and `/jev subagents off`), `docs/scenarios.md` (turn floor rules and the turns-only launch), `docs/configuration.md` (what the `subagents` switch covers) and `docs/jev-contract.md` (launches left untouched, worker questions)
- [ ] 6.2 Add an `Unreleased` entry to `CHANGELOG.md` for the turn floor and the executor `v0.2.0` requirement
- [ ] 6.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`; all pass
