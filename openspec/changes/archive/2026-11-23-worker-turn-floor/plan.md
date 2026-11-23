# Worker Turn Floor Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Let Jev raise a limited worker's `max_turns` to a band floor (raise-only), recorded in the ledger, failing open.

**Architecture:** A pure turn floor in `src/policy/worker/turns.ts` reads a new `turns` answer; `routeLaunch` adds its write to every routed path and gains a turns-only path for launches it otherwise leaves untouched. The host passes `requested.maxTurns` and `locked` into the launch facts, asks `turns` when the launch can raise, and returns `maxTurns` in the adjustment.

**Tech Stack:** TypeScript on Bun (`bun test`, `bun check`, oxlint, oxfmt), Pi 1.5.0, `@ttdua/pi-subagents` v0.2.0 (types only), TypeSafe Jev.

## Global Constraints

- `src/policy/` is pure: no import from `src/host/`, `src/store/` or Pi.
- No runtime import of `@ttdua/pi-subagents` under `src/`; `import type` only.
- Fail open: any Jev failure or routing error returns no `maxTurns` (and no model or thinking, as today).
- Decide on probabilities, never on confidence.
- Never store prompt text, tool arguments or tool output; tests use no secrets, no paid calls and no network beyond loopback.
- Band floors exactly: `short` none, `medium` 40, `long` 100, `very_long` 200. Cumulative threshold `.5`, tolerance `1e-9`.
- Ledger `v` stays `1`; new fields are optional and follow `locked` in `LEDGER_FIELDS.worker`.
- Public-repo text in English; commits in English.
- Verify with `bun run typecheck && bun run lint && bun run fmt:check && bun run test`.

## Review Focus

- A `turns` answer whose keys are not exactly the four bands: `checkChoice` (`src/policy/answers.ts`) reads it as unanswered (reason `probabilities`), so no `maxTurns` is written. Test in Task 2 (`Partial band map is unanswered` in `tests/policy/worker/answers.test.ts`). `turnFloor` itself still treats a missing band as 0 and ignores unknown keys (Task 3 `turnFloor ignores unknown keys`). Host fakes and the real-CLI Jev helper MUST emit all four band keys, or a test silently sees "Turns unanswered".
- `requested.maxTurns` of 2 (the executor minimum) with floor 40: must raise. Test in Task 3 (`turnWrite raises from the minimum`).
- A launch whose agent locks `max_turns` but not model or thinking: routed as today, with no `turns` question and no `maxTurns`. Test in Task 3 (`launchKind locked max_turns asks no turns`) and Task 5 host test.
- Fork with `forkLaunch` `thinking` and thinking locked but a limit: turns-only, not untouched. Covered by Task 3 pin table (64 combinations).
- Ledger line for a launch that asked `turns` but whose answer was cancelled: no line at all (unchanged `skip`). Test in Task 3 (`Turns-only cancelled`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `LaunchRequestFacts` (`src/policy/launch.ts`) | modified | adds `requestedMaxTurns: number \| undefined` | no |
| `EffectiveLaunch` (`src/policy/launch.ts`) | modified | adds `maxTurns: number \| undefined; turnsLocked: boolean` | no |
| `canRaiseTurns` (`src/policy/launch.ts`) | new | `(launch: EffectiveLaunch) => boolean` — `maxTurns !== undefined && !turnsLocked` | no |
| `TURN_BANDS` (`src/policy/worker/turns.ts`) | new | `readonly ["short","medium","long","very_long"]`; `type TurnBand = (typeof TURN_BANDS)[number]` | no |
| `BAND_FLOOR` | new | `Readonly<Partial<Record<TurnBand, number>>> = { medium: 40, long: 100, very_long: 200 }` | no |
| `turnFloor` | new | `(answer: Answer \| undefined) => number \| undefined` | no |
| `turnWrite` | new | `(floor: number \| undefined, launch: EffectiveLaunch) => number \| undefined` | no |
| `LaunchKind` (`src/policy/worker/route.ts`) | modified | `{ kind: "untouched"; locked: boolean } \| { kind: "ask"; routeQuestions: boolean; tierQuestion: boolean; turnsQuestion: boolean; locked: boolean }` (key order as written) | no |
| `Route` routed `write` / `record` | modified | `write` adds `maxTurns?: number`; `record` adds `turnFloor?: number` (after `effort`) | no |
| `buildWorkerQuestions` (`src/jev/questions.ts`) | modified | `(offered, displayNames, slots = [], ask: { route: boolean; turns: boolean } = { route: true, turns: false })` | no |
| `WORKER_TURNS_QUESTION` (`src/jev/rubrics.ts`) | new | `WireQuestion`, `type: "choice"`, criteria keys in `TURN_BANDS` order | no |
| `RouteWrite` (`src/host/worker/route.ts`) | modified | `{ model?: string; thinking?: ThinkingLevel; maxTurns?: number }` | no |
| `WorkerLineInput` (`src/policy/worker/worker-line.ts`) | modified | adds `turnsQuestion: boolean; requestedTurns: number \| undefined` | no |
| Worker ledger line (`ledger.jsonl`) | modified | optional `requestedTurns: count`, `turnsP: turns distribution`, `turnFloor: count`, after `locked` | yes (file format) |
| Worker ledger line turn use | modified | optional `turnsUsed: count`, `turnPhase: "within" \| "warned" \| "exhausted"`, after `toolUses` | yes (file format) |
| `ExecutorOutcome` (`src/policy/worker/worker-line.ts`) | modified | adds `turnBudget?: unknown` | no |
| `turns` Jev question | new | choice over `short`, `medium`, `long`, `very_long` (wire format of `docs/jev-questions.md`) | yes (Jev request) |
| Launch adjustment | modified | may carry `maxTurns` (positive integer from `BAND_FLOOR`) | yes (executor contract v0.2.0) |
| `devDependencies["@ttdua/pi-subagents"]` | modified | `github:ttdua/pi-subagents#v0.2.0` | yes |

---

## Task 1: Executor pin to v0.2.0 — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `package.json`, `bun.lock`, `README.md`, `docs/usage-guide.md`
- Test: `tests/release.test.ts` (real-file check, unchanged), `tests/host/worker-fakes.ts` (type-check only)

- [ ] **Step 1:** Set `devDependencies["@ttdua/pi-subagents"]` to `github:ttdua/pi-subagents#v0.2.0`; run `bun install`. Expected: `bun.lock` updated, `node_modules/@ttdua/pi-subagents/package.json` version 0.2.0.
- [ ] **Step 2:** Replace `pi install git:github.com/ttdua/pi-subagents@v0.1.1` with `@v0.2.0` in `README.md` and `docs/usage-guide.md` only. Leave `CHANGELOG.md` 0.6.0 entry, `docs/evidence/`, `tests/host/evidence.test.ts` and fixture strings in `tests/release.test.ts` as they are.
- [ ] **Step 3:** Run `bun run typecheck && bun test tests/release.test.ts tests/manifest.test.ts`. Expected: pass. `grep -n "maxTurns" node_modules/@ttdua/pi-subagents/src/service/service.ts` shows `requested.maxTurns` and `LaunchAdjustment.maxTurns`. The executor's `defaultMaxTurns` is unset (unlimited) by default (`src/settings.ts`), so existing real-CLI tests without `max_turns` stay unlimited and ask no `turns`.
- [ ] **Step 4:** Commit `chore: pin @ttdua/pi-subagents v0.2.0`.

---

## Task 2: Turns question and wording — implements 2

**Covers:** 2.1, 2.2, 2.3
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `src/policy/worker/turns.ts` (bands only in this task)
- Modify: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `docs/jev-questions.md`, `docs/jev-contract.md` (`classify.ts` is untouched: the default `ask` keeps today's behaviour)
- Test: `tests/jev/questions.test.ts`, `tests/policy/worker/answers.test.ts`

**Interfaces:**
- Produces: `TURN_BANDS`, `TurnBand`, `WORKER_TURNS_QUESTION`, `buildWorkerQuestions(..., ask)` (see Contracts).

- [ ] **Step 1:** Add a `### Turns` section to `docs/jev-questions.md` after the tier and slot sections (not inside "Worker rubric", whose table rows `tests/jev/questions.test.ts` parses) with this exact wording, and a `turns` row (choice, the four bands, "Turn floor") to the worker question table in `docs/jev-contract.md`:
  - Instruction: `How many steps and tool calls does a subagent need to finish this brief? Count the files to read and change, the commands to run and the checks to repeat until it is done. How rare the knowledge is and how much care the task needs are not turn signals.`
  - `short`: `Up to about 20 steps: a lookup, a single change with its check, or a short review.`
  - `medium`: `About 20 to 40 steps: an ordinary change across a few files with tests to run and fix.`
  - `long`: `About 40 to 100 steps: a change across many files, a feature with its tests, or a migration with repeated checks.`
  - `very_long`: `More than about 100 steps: a large refactor or sweep over many files, or a long investigation with many runs.`
- [ ] **Step 2: Write failing tests** in `tests/jev/questions.test.ts`:
  - `turns wording matches the docs`: as the existing "every instruction and criterion appears verbatim" test does, `docs` contains `WORKER_TURNS_QUESTION.instructions` and every criterion verbatim.
  - `Band order`: `Object.keys(WORKER_TURNS_QUESTION.criteria)` and the `turns` spec options equal `["short","medium","long","very_long"]`.
  - `Turns with the route questions`: `buildWorkerQuestions(["basic"], {}, [], { route: true, turns: true })` keys are `["tier","effort","risky","turns"]`.
  - `Turns only`: `buildWorkerQuestions(["basic"], {}, [], { route: false, turns: true })` questions and specs keys are `["turns"]`.
  - Existing set tests (No tier configured, Slot alone, Expert offered, Asked and accepted agree) stay unchanged and pass with the default `ask`.
  In `tests/policy/worker/answers.test.ts`: `Unknown band` (`turns` choice `huge` → unanswered with reason `choice`, `effort` still read) `Jev failure` (a `timeout` miss outcome with `turns` in the specs → miss `timeout`, no answers), and `Partial band map is unanswered` (`turns` probabilities over three bands → unanswered with reason `probabilities`).
- [ ] **Step 3:** Run `bun test tests/jev/questions.test.ts tests/policy/worker/answers.test.ts`. Expected: FAIL (missing exports).
- [ ] **Step 4:** Implement `TURN_BANDS` in `src/policy/worker/turns.ts`, `WORKER_TURNS_QUESTION` in `src/jev/rubrics.ts` (verbatim copy of the docs), and the `ask` parameter in `buildWorkerQuestions`; `turns` spec is `{ type: "choice", options: [...TURN_BANDS] }`. With `route: false` skip `tier`, `effort`, `risky`.
- [ ] **Step 5:** Run the two test files, then `bun run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(jev): add the worker turns question`.

---

## Task 3: Pure turn floor and route — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4
**Difficulty:** Hard
**Blocked by:** Task 1, Task 2

**Files:**
- Modify: `src/policy/launch.ts`, `src/policy/worker/turns.ts`, `src/policy/worker/route.ts`, `src/policy/worker/index.ts`, `src/host/worker/request.ts` (one line: pass `requestedMaxTurns`)
- Test: `tests/policy/launch.test.ts`, `tests/policy/worker/turns.test.ts` (new), `tests/policy/worker/route.test.ts`, `tests/policy/worker/route-pin.test.ts`

**Interfaces:**
- Consumes: `TURN_BANDS` (Task 2); `LaunchRequest.requested.maxTurns` type (Task 1).
- Produces: `canRaiseTurns`, `turnFloor`, `turnWrite`, `BAND_FLOOR`, new `LaunchKind`, `Route` with `write.maxTurns` and `record.turnFloor` (see Contracts). Export `turnFloor`, `turnWrite`, `TURN_BANDS` from `src/policy/worker/index.ts`.

- [ ] **Step 1: Failing tests, launch facts** (`tests/policy/launch.test.ts`, describe `Turn limit of a launch`): `Limited launch` (`requestedMaxTurns` 20, `locked` [] → `maxTurns` 20, `turnsLocked` false, `canRaiseTurns` true); `Unlimited launch` (`requestedMaxTurns` undefined → false); `Locked limit` (`locked` ["max_turns"] → false). Update "Resume is not a launch field" in `tests/policy/launch.test.ts` (it pins the exact `EffectiveLaunch` keys) to include `maxTurns` and `turnsLocked`, and give the helpers that build `EffectiveLaunch` / `LaunchRequestFacts` (`request()` in `launch.test.ts`, `launch()` and `serviceRequest()` in `route.test.ts`, `launch()` in `route-pin.test.ts`) the defaults `maxTurns: undefined, turnsLocked: false, requestedMaxTurns: undefined`.
- [ ] **Step 2: Failing tests, floor and write** (`tests/policy/worker/turns.test.ts`): one test per scenario with the spec's exact numbers — `Long by majority` → 100, `Thin tail does not raise` → undefined, `Cumulative at the bar` → 40, `Choice is not enough` → 40, `Very long` → 200, `Probabilities not normalised` → undefined, `Unanswered` → undefined, plus `turnFloor ignores unknown keys` (`{ short: .2, long: .6, huge: .9 }` → 100). `turnWrite`: `Raised` (20, floor 100 → 100), `Limit already above the floor` (120, 100 → undefined), `Limit equal to the floor` (40, 40 → undefined), `No floor` (20, undefined → undefined), `turnWrite raises from the minimum` (2, 40 → 40), unlimited and locked launches → undefined.
- [ ] **Step 3:** Run `bun test tests/policy/launch.test.ts tests/policy/worker/turns.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `requestedMaxTurns` → `maxTurns`, `turnsLocked = locked.includes("max_turns")`, `canRaiseTurns` in `src/policy/launch.ts`, and add `requestedMaxTurns: request.requested.maxTurns` to the `effectiveLaunch` call in `src/host/worker/request.ts` `newEntry`; `BAND_FLOOR`, `turnFloor` and `turnWrite` in `turns.ts`. `turnFloor` algorithm: read only a `choice` answer's `probabilities`; walk `very_long`, `long`, `medium`, adding each band's probability (missing → 0) to a running sum; return that band's floor at the first sum `>= 0.5 - 1e-9`; else undefined.
- [ ] **Step 5:** Run the two files. Expected: PASS.
- [ ] **Step 6: Failing tests, launch kind.** In `route-pin.test.ts`, extend `expectedKind` and the case loop with `raise: boolean` (64 combinations): the old untouched cases become `untouched` only when `!raise`, else `{ kind: "ask", routeQuestions: false, tierQuestion: false, turnsQuestion: true, locked }`; ask cases gain `routeQuestions: true` and `turnsQuestion: raise`. Update key-order test to `["kind","routeQuestions","tierQuestion","turnsQuestion","locked"]`. In `route.test.ts` update `launchKind` expectations, and add `Both fields locked with a turn limit`, `Both fields and the limit locked`, `launchKind locked max_turns asks no turns` (model and thinking free, `max_turns` locked → ask with `turnsQuestion` false).
- [ ] **Step 7: Failing tests, route.** In `route.test.ts`, add a `read()` option `turns?: Record<string, number>` producing a `turns` choice answer, and one test per scenario: inside `describe("Turn write")`: `Next to a routed model`, `Next to a thinking-only write`, `Model locked`; then `Both fields locked with a limit`, `Fork untouched with a limit`, `Turns-only miss`, `Turns-only cancelled`, `Miss with a turn limit`, `Thinking locked with a turn floor`, `Nothing can run with a turn floor`, `Locked untouched launch` (no limit → `untouched`). Assert exact `write` and `record` objects, including `turnFloor`. Existing route tests must pass unchanged apart from the new `LaunchKind` shape.
- [ ] **Step 8:** Run `bun test tests/policy/worker/route.test.ts tests/policy/worker/route-pin.test.ts`. Expected: FAIL.
- [ ] **Step 9:** Implement in `route.ts`: `launchKind(launch, offered, forkLaunch, slotCount)` computes the old result, then if it is `untouched` and `canRaiseTurns(launch)` returns the turns-only `ask`; otherwise sets `routeQuestions: true`, `turnsQuestion: canRaiseTurns(launch)`. In `routeLaunch`, after cancel/miss handling: if `!kind.routeQuestions` return `withTurns({ kind: "routed", write: {}, record: { reason: "untouched", ...locked } }, answers, launch)`; every other non-miss `routed` result also goes through `withTurns(route, answers, launch)`, which sets `write.maxTurns` and `record.turnFloor` from `turnWrite(turnFloor(answers.answers["turns"]), launch)`. Miss results never pass through it.
- [ ] **Step 10:** Run `bun test tests/policy` and `bun run typecheck`. Expected: PASS; host callers still compile because `tierQuestion` is kept and `request.ts` passes `requestedMaxTurns`.
- [ ] **Step 11:** Commit `feat(policy): add the worker turn floor`.

---

## Task 4: Ledger turn fields — implements 4

**Covers:** 4.1, 4.2
**Difficulty:** Normal
**Blocked by:** Task 3

**Files:**
- Modify: `src/store/ledger-schema.ts`, `src/policy/worker/worker-line.ts`
- Test: `tests/store/ledger-schema.test.ts`, `tests/store/ledger-pin.test.ts`, `tests/policy/worker/worker-line.test.ts`

**Interfaces:**
- Consumes: `TURN_BANDS`, `Route.record.turnFloor` (Task 3).
- Produces: `WorkerLineInput.turnsQuestion`, `WorkerLineInput.requestedTurns`; schema fields `requestedTurns`, `turnsP`, `turnFloor`.

- [ ] **Step 1: Failing tests, schema:** `Worker line with turn fields accepted`, `Unknown band rejected` (issue at `turnsP`), `Exported field sets match the table` in `tests/store/ledger-schema.test.ts` (update the expected worker list: `requestedTurns`, `turnsP`, `turnFloor` right after `locked`), `Older worker line still accepted` and `Old line still valid` (a line without the fields passes). In `tests/store/ledger-pin.test.ts`: add `WORKER_BAD` entries for `requestedTurns` (`-1`), `turnsP` (`[]`) and `turnFloor` (`-1`) so "every field of the schema has a pinned bad value" passes; add the three fields to the `WORKER` fixture; add `turn bands agree` asserting `TURN_BAND_KEYS` equals `TURN_BANDS`. In the "largest line fits" test add a full `turnsP` and both counts.
- [ ] **Step 2: Failing tests, line** (`worker-line.test.ts`, default input gains `turnsQuestion: false, requestedTurns: undefined`): `Raised limit recorded`, `Asked but not raised`, `Unlimited launch`, `Turns-only recorded` (with `effort` absent), `Turn miss recorded`, `Untouched recorded` with no limit unchanged; each built line passes `validateLedgerEntry`, and key order puts the turn fields after `locked`.
- [ ] **Step 3:** Run the three test files. Expected: FAIL.
- [ ] **Step 4:** Implement: a `turns distribution` shape like `effortP` over `TURN_BAND_KEYS`, declared in `src/store/ledger-schema.ts` (the store imports nothing from `src/policy/`); `WorkerEntry` and `LEDGER_FIELDS.worker` gain the three fields after `locked`; `workerShape` adds `requestedTurns: count()`, `turnsP`, `turnFloor: count()`. Change `routeFields(line, route)` to `routeFields(line, route, input)` and, between `locked` and `model` (the schema order), add via a `turnFields(line, input, route)` helper: `requestedTurns` when `turnsQuestion`, `turnsP` from `probabilities(answers.answers["turns"], TURN_BANDS)` when answered, `turnFloor` from `route.record.turnFloor`.
- [ ] **Step 5:** Run `bun test tests/store tests/policy/worker`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(ledger): record worker turn fields`.

---

## Task 5: Host wiring — implements 5

**Covers:** 5.1, 5.2, 5.3, 5.4
**Difficulty:** Hard
**Blocked by:** Task 1, Task 4

**Files:**
- Modify: `src/host/worker/classify.ts`, `src/host/worker/route.ts`, `src/host/worker/outcomes.ts`
- Test: `tests/host/worker/policy.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/worker-fakes.ts`

**Interfaces:**
- Consumes: all Task 3 and Task 4 contracts; `LaunchRequest.requested.maxTurns` (Task 1).
- Produces: adjustment `maxTurns`.

- [ ] **Step 1: Failing fake-host tests** (`tests/host/worker/policy.test.ts`, using `launchRequest({ requested: { maxTurns: 20 } })` and Jev bodies with a `turns` answer; extend `worker-fakes.ts` `body`/`bodyWith` with an optional `turns` probabilities map that always carries all four bands, filling missing ones with 0):
  - `Limited launch asks turns` (request questions include `turns`), `Unlimited launch does not ask turns`.
  - `Turn limit raised` (adjustment `maxTurns` 100), `Turn limit left alone` (no limit; `locked: ["max_turns"]`; `maxTurns` 120 with floor 100 → no `maxTurns`).
  - `Switch off keeps the turn limit` (no ask, adjustment undefined).
  - `Jev failure keeps the turn limit` (HTTP 500 → adjustment undefined), `Turns unanswered` (model and thinking written, no `maxTurns`).
  - `Both fields locked with a turn limit` sends a request whose questions are exactly `turns`.
  - `Forked launch with thinking asks fewer questions` keeps `effort` and `risky` only with no limit.
- [ ] **Step 2: Failing ledger tests** (`tests/host/worker-ledger.test.ts`): `Raised limit recorded`, `Asked but not raised`, `Turns-only recorded`, `Turn miss recorded` through `runToCompletion`, each line passing `validateLedgerEntry`.
- [ ] **Step 3:** Run `bun test tests/host/worker tests/host/worker-ledger.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement (`requestedMaxTurns` is already wired in Task 3): `classifyLaunch` calls `buildWorkerQuestions(..., { route: kind.routeQuestions, turns: kind.turnsQuestion })` with tier inputs only when `kind.tierQuestion`; `RouteWrite` adds `maxTurns` and `routeLaunchEntry` copies `result.write` as today (spread already includes it); `writeLine` passes `turnsQuestion: launch.kind.kind === "ask" && launch.kind.turnsQuestion` and `requestedTurns: launch.launch.maxTurns`.
- [ ] **Step 5:** Run the step 3 files. Expected: PASS.
- [ ] **Step 6: Failing real-CLI test** (`tests/host/worker-routing.test.ts`): `turn limit raised through the executor` — `subagentCall(launch({ max_turns: 20 }))`, Jev answers `tier` `basic`, `effort` `medium` and `turns` `{ short: .1, medium: .2, long: .6, very_long: .1 }`; expect the worker ledger line `requestedTurns` 20 and `turnFloor` 100, and the `subagents:record` custom entry in the main session file (read like `turnAnchors` in `tests/host/effort-hold.test.ts`) to have `turnBudget.maxTurns` 100. Add `turn limit kept on Jev error` (Jev HTTP 500 → `turnBudget.maxTurns` 20) and `turn limit kept with the switch off` (`subagents` off, `max_turns` 20 → `turnBudget.maxTurns` 20, no Jev request). Extend the test's Jev answer helper with `turns`, always emitting all four bands.
- [ ] **Step 7:** Run `bun test tests/host/worker-routing.test.ts`. Expected: PASS after step 4 (FAIL first if run before it).
- [ ] **Step 8:** Run `bun run test`. Expected: all pass.
- [ ] **Step 9:** Commit `feat(worker): raise a tight worker turn limit`.

---

## Task 6: Docs and changelog — implements 6

**Covers:** 6.1, 6.2, 6.3
**Difficulty:** Easy
**Blocked by:** Task 5

**Files:**
- Modify: `README.md`, `docs/scenarios.md`, `docs/configuration.md`, `docs/jev-contract.md`, `CHANGELOG.md`

- [ ] **Step 1:** `README.md`: in the worker routing feature row say it also raises a too-tight `max_turns` (never lowers, never adds one), turned off with `/jev subagents off`. `docs/scenarios.md`: add the turn floor rule (bands, floors, median rule, raise-only) and the turns-only launch. `docs/configuration.md`: the `subagents` switch also covers the turn floor. `docs/jev-contract.md`: "launches left untouched" section says a launch with a turn limit sends a `turns`-only request.
- [ ] **Step 2:** `CHANGELOG.md` `[Unreleased]`: `### Added` — worker turn floor (`turns` question, raise-only `maxTurns`, ledger `requestedTurns`, `turnsP`, `turnFloor`); `### Changed` — requires `@ttdua/pi-subagents` v0.2.0.
- [ ] **Step 3:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all pass (including `tests/docs-old-names.test.ts` and `tests/release.test.ts`).
- [ ] **Step 4:** Commit `docs: describe the worker turn floor`.

---

## Task 7: Measured turn use in the ledger — implements 7

**Covers:** 7.1, 7.2
**Difficulty:** Easy
**Blocked by:** Task 4

Added in post-PR iteration 2, approved by the user in chat (data for issue #104).

**Files:**
- Modify: `src/policy/worker/worker-line.ts`, `src/host/worker/entry.ts`, `src/store/ledger-schema.ts`, `docs/domain-model.md`, `CHANGELOG.md`
- Test: `tests/policy/worker/worker-line.test.ts`, `tests/store/ledger-schema.test.ts`, `tests/store/ledger-pin.test.ts`, `tests/host/worker-ledger.test.ts`

- [ ] **Step 1: Failing tests:** `worker-line.test.ts` "Turn use recorded" (37/`within`), "Exhausted run recorded" (20/`exhausted`), "No turn budget", "Unknown phase dropped" (5, no phase), and key order (`turnsUsed`, `turnPhase` right after `toolUses`). `ledger-schema.test.ts` "Worker line with turn use accepted", "Bad turn phase rejected" (issue at `turnPhase`), and the exported worker field list. `ledger-pin.test.ts`: `WORKER_BAD` gains `turnsUsed` (`-1`) and `turnPhase` (`"paused"`); the `WORKER` fixture and the largest-line test carry both. `worker-ledger.test.ts` host test: an outcome event with `turnBudget` writes both fields.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** `slim` keeps `turnBudget: { used, phase }` when `data.turnBudget` is a record; `executorFields` writes `turnsUsed` via `count(used)` and `turnPhase` only when `phase` is one of the three; the schema adds both after `toolUses`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Update the `docs/domain-model.md` ledger table and the `CHANGELOG.md` Unreleased entry; run `bun run typecheck && bun run lint && bun run fmt:check && bun run test`.
- [ ] **Step 5:** Commit `feat(ledger): record measured worker turn use`.

---

## Scenario → test

**worker-request**
- Wording matches the docs → `tests/jev/questions.test.ts` "turns wording matches the docs"
- Band order → `tests/jev/questions.test.ts` "Band order"
- Unknown band → `tests/policy/worker/answers.test.ts` "Unknown band"
- Jev failure → `tests/policy/worker/answers.test.ts` "Jev failure"
- No tier configured, Slot alone, Expert offered, Asked and accepted agree → existing tests in `tests/jev/questions.test.ts`
- Turns with the route questions, Turns only → `tests/jev/questions.test.ts` same names

**worker-decision**
- Limited launch, Unlimited launch, Locked limit → `tests/policy/launch.test.ts` "Turn limit of a launch"
- Long by majority, Thin tail does not raise, Cumulative at the bar, Choice is not enough, Very long, Probabilities not normalised, Unanswered → `tests/policy/worker/turns.test.ts` same names
- Raised, Limit already above the floor, Limit equal to the floor, No floor → `tests/policy/worker/turns.test.ts` same names
- Next to a routed model, Next to a thinking-only write, Model locked (Turn write) → `tests/policy/worker/route.test.ts` `describe("Turn write")` same names
- Both fields locked with a limit, Fork untouched with a limit, Turns-only miss, Turns-only cancelled → `tests/policy/worker/route.test.ts` same names
- Route result: Locked flag, Locked untouched launch, No lock, Service launch naming a model → existing and updated tests in `tests/policy/worker/route.test.ts`
- Launches left untouched: Resume → `tests/host/worker/policy.test.ts` existing resume test; Forked launch left alone, Both fields locked, Service launch with a model and locked thinking, Forked thinking with thinking locked, Slot alone with thinking locked → `route-pin.test.ts` 64-combination table and existing `route.test.ts`; Both fields locked with a turn limit, Both fields and the limit locked → `route.test.ts` same names
- Route on Jev failure: Cancelled, Miss → existing `route.test.ts`; Miss with a turn limit → `route.test.ts` same name
- Route writes thinking only: Forked launch with thinking, No tier offered, No tier decided, Slot below the bar with no tier, No effort answer, No tier decided with thinking locked, Jev fails for a fork with thinking → existing `route.test.ts`; Thinking locked with a turn floor → `route.test.ts` same name
- Nothing can run: All lower tiers unusable, Expert never a cascade target, Unusable slot alone → existing `route.test.ts`; Nothing can run with a turn floor → `route.test.ts` same name
- Locks in the route: Model locked, Model locked without a decided tier, Thinking locked, Model locked with a slot decided, Service launch with a model → existing `route.test.ts`

**worker-routing**
- Display name prefix, Slot display name, Parent request off, Service launch content → existing `tests/host/worker/policy.test.ts`
- Forked launch with thinking asks fewer questions → `tests/host/worker/policy.test.ts` (updated, no limit)
- Limited launch asks turns, Unlimited launch does not ask turns → `tests/host/worker/policy.test.ts` same names
- Caller model replaced, Background launch, Effective values recorded → existing `tests/host/worker-routing.test.ts`
- Resume untouched → existing resume tests in `tests/host/worker/policy.test.ts` and `tests/host/worker-ledger.test.ts` (the policy is never called, so no `maxTurns` can be written; the executor keeps the session limit, specified by `ttdua/pi-subagents`)
- Turn limit raised → `tests/host/worker/policy.test.ts` "Turn limit raised" and `tests/host/worker-routing.test.ts` "turn limit raised through the executor"
- Switch off keeps the turn limit → `tests/host/worker/policy.test.ts` same name and `tests/host/worker-routing.test.ts` "turn limit kept with the switch off"
- Turn limit left alone → `tests/host/worker/policy.test.ts` same name
- Jev timeout, Timeout changed after session start, Jev error, Unreadable answers, Turn cancelled, Internal error → existing `tests/host/worker/policy.test.ts` "Routing fails open"
- Jev failure keeps the turn limit → `tests/host/worker/policy.test.ts` same name and `tests/host/worker-routing.test.ts` "turn limit kept on Jev error"
- Turns unanswered → `tests/host/worker/policy.test.ts` same name

**worker-ledger**
- Raised limit recorded, Asked but not raised, Unlimited launch, Turns-only recorded, Turn miss recorded → `tests/policy/worker/worker-line.test.ts` and `tests/host/worker-ledger.test.ts` same names
- Old line still valid → `tests/store/ledger-schema.test.ts` "Old line still valid"
- Worker decision fields (Routed fields … Slot fallback recorded, 12 scenarios) → existing `tests/policy/worker/worker-line.test.ts` and `tests/host/worker-ledger.test.ts` "Decision fields"; Untouched recorded updated for no turn limit

**decision-ledger**
- NaN probability rejected, Slot target accepted, Target distribution capped at 12, Score out of range rejected, Fractional rubric rejected, Malformed target rejected → existing `tests/store/ledger-schema.test.ts`
- Unknown band rejected → `tests/store/ledger-schema.test.ts` same name
- Valid main line accepted … Bad effective thinking rejected (12 scenarios) → existing `tests/store/ledger-schema.test.ts`; Exported field sets match the table → `tests/store/ledger-schema.test.ts` (updated list)
- Worker line with turn fields accepted → `tests/store/ledger-schema.test.ts` same name

**worker-ledger (turn use)**
- Turn use recorded, Exhausted run recorded, No turn budget, Unknown phase dropped → `tests/policy/worker/worker-line.test.ts` same names; host join → `tests/host/worker-ledger.test.ts` "Turn use joined from the executor"

**decision-ledger (turn use)**
- Worker line with turn use accepted, Bad turn phase rejected → `tests/store/ledger-schema.test.ts` same names
