# Service Wait and Escalation Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`specs/service-launch-wait/spec.md`, `specs/launch-metadata/spec.md`, `specs/executor-launch-identity/spec.md`, `specs/host-seam-evidence/spec.md`) and `design.md`.

**Goal:** An extension can wait for one service launch, receive its outcome or `ask_parent` question without the main model being nudged, and answer by resuming. Observers get `subagents:asked`, and `subagents:update` gets launch fields.

**Architecture:** `SubagentsServiceAdapter.wait()` is a carrier. It claims the record's current run, awaits `Subagent.waitForRunEnd` (the run's terminal funnel, design D5), and either resolves with a snapshot of the waited run or releases its claim on abort, following the existing `get_subagent_result` `wait` pattern (design D1, D2). The ask recorder in `Subagent.run()` also notifies the observer chain, which emits `subagents:asked` (D3). The update payload spreads `launchFields` (D4).

**Tech Stack:** TypeScript, vitest (vendored package `packages/pi-subagents/`), Bun at the root, host harness in `tests/host/` (real Pi CLI in RPC mode, loopback recording fixture).

## Global Constraints

- **Additive only:** no existing field, status or event changes name, type or meaning; `pendingQuestion` stays `string | undefined`; no new `SubagentStatus`.
- **Tool-call launches:** routing and notifications are unchanged; they only gain the new event and the `launchFields` on `subagents:update`.
- **Absent fields omitted:** `toolCallId` and `metadata` appear on `subagents:update` and `subagents:asked` only under the rules of `launchFields` (the same as the other record events).
- **Not persisted:** `subagents:asked` and `subagents:update` append no session entry; `src/persisted-record.ts` is not changed.
- **Vendored-tree rules:** every edited upstream file gets a `VENDORED.md` row. jev-pilot's lint, typecheck and import-graph do not cover `packages/`.
- **Probe privacy:** host probes record event names, ids, statuses, booleans and counts only, never prompt text, question text or answers (`tests/host` rejects `JEV-MARKER-` in reports).
- **Tests:** no secrets, no paid calls, no network beyond loopback. `verify:public-types` installs a scratch consumer with `bun add`; run it only with a warm Bun cache, and if it needs the registry, record it as blocked in the receipt instead of running it online.

## Review Focus

- **Claim leak on abort:** a wait whose signal aborts must release only its own claim. A leaked claim silences the nudge for good. Pinned in Task 2 (`aborted wait gives the outcome back`).
- **Waiter vs resume race:** a consumer that resumes inside the `subagents:completed` listener replaces the run before the waiter continues. The snapshot must still describe the waited run, including its question. Pinned in Task 2 (`resumed before the waiter reads it`).
- **Signal already aborted, run settled:** the outcome wins. Pinned in Task 2.
- **Queued launch behind a busy slot:** the wait spans the queue, and an abort while queued resolves `stopped` without waiting for the slot. Pinned in Task 2 (`waits through the queue` and `stopped while queued behind a busy slot`).
- **Mixed carriers:** releasing a service wait's claim must not override a `get_subagent_result` wait's claim. Pinned in Task 2 (`another carrier still holds the run`).
- **Failed run after a question:** `fail()` drops the question, so the wait resolves `error` with no `pendingQuestion`. `subagents:asked` was already emitted. Pinned in Task 2 (`failure after ask`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `WaitOptions` | new | `interface WaitOptions { signal?: AbortSignal }` (exported from `src/service/service.ts`) | yes |
| `SubagentsService.wait` | modified (new method) | `wait(id: string, options?: WaitOptions): Promise<SubagentRecord>`; rejects `Error("Unknown agent \"<id>\"")` for an unknown id, and `signal.reason` on abort | yes |
| `SUBAGENT_EVENTS` | modified | adds `UPDATE: "subagents:update"`, `ASKED: "subagents:asked"` | yes |
| `subagents:asked` payload | new | `{ id: string; type: string; description: string; question: string; toolCallId?: string; metadata?: LaunchMetadata }` | yes (event) |
| `subagents:update` payload | modified | adds `toolCallId?: string; metadata?: LaunchMetadata` to `{ id, type, description, message }` | yes (event) |
| `dist/public.d.ts` | modified | regenerated; exports `WaitOptions` and the new method/constants | yes |
| `SubagentLifecycleObserver.onQuestionAsked` (`src/lifecycle/subagent.ts`) | new | `onQuestionAsked?(agent: Subagent, question: string): void` | no |
| `SubagentManagerObserver.onSubagentQuestion` (`src/lifecycle/subagent-manager.ts`) | new | `onSubagentQuestion?(record: Subagent, question: string): void` | no |
| `RunOutcome.question` (`src/lifecycle/subagent-run.ts`) | new | `readonly question: string \| undefined`: the question the run recorded, also after `replaced` (the existing `pendingQuestion` getter stays as is) | no |
| `SubagentRun.finished` / `markFinished` (`src/lifecycle/subagent-run.ts`) | new | `readonly finished: Promise<void>`; `markFinished(): void`, idempotent, resolves `finished` | no |
| `Subagent.waitForRunEnd` (`src/lifecycle/subagent.ts`) | new | `waitForRunEnd(signal: AbortSignal): Promise<RunOutcome>`: captures `currentRun`; returns at once when it is not active; otherwise races `run.finished` with the signal; returns the captured run | no |
| `toWaitedRecord` (`src/service/service-adapter.ts`) | new | `toWaitedRecord(record: Subagent, run: RunOutcome): SubagentRecord`: `toSubagentRecord(record)` with `status`, `result`, `error`, `startedAt`, `completedAt`, `turnBudget` and `pendingQuestion` (from `run.question`) taken from `run`; each optional field omitted when undefined | no |

---

## Task 1: Question event and launch fields on updates — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `packages/pi-subagents/src/lifecycle/subagent.ts` (observer interface near line 43; `askParent` in `run()` near line 497)
- Modify: `packages/pi-subagents/src/lifecycle/subagent-manager.ts` (`SubagentManagerObserver` near line 160; relay near line 328)
- Modify: `packages/pi-subagents/src/observation/composite-subagent-observer.ts`
- Modify: `packages/pi-subagents/src/observation/subagent-events-observer.ts`
- Modify: `packages/pi-subagents/src/service/service.ts` (`SUBAGENT_EVENTS`)
- Test: `packages/pi-subagents/test/observation/subagent-events-observer.test.ts`, `packages/pi-subagents/test/observation/composite-subagent-observer.test.ts`, `packages/pi-subagents/test/lifecycle/subagent.test.ts`, `packages/pi-subagents/test/seams/launch-metadata-flow.test.ts`

**Interfaces:**
- Produces: `onQuestionAsked`, `onSubagentQuestion`, `SUBAGENT_EVENTS.UPDATE`, `SUBAGENT_EVENTS.ASKED` (see Contracts).

- [ ] **Step 1: Write failing tests**
  - `subagent-events-observer.test.ts`, `describe("onSubagentQuestion")`:
    - `emits subagents:asked with id, type, description, question`, with `toolCallId: "call_5"` when the record has `currentToolCallId`, and `metadata` when it has metadata;
    - `omits toolCallId and metadata when absent`;
    - `persists nothing and announces nothing` (`appendEntry` and the notification fakes not called).
  - `describe("onSubagentUpdate")`: `adds toolCallId and metadata from the launch` and `omits them when absent`, while `sendUpdate` is still called once.
  - `composite-subagent-observer.test.ts`: `dispatches onSubagentQuestion to every observer`.
  - `subagent.test.ts`, next to `records a question the child declares mid-run`: `tells the observer about a declared question after recording it`. The observer spy reads `agent.pendingQuestion === "Which config?"` inside the callback.
  - `launch-metadata-flow.test.ts`: `subagents:asked precedes subagents:completed for a service launch`, driven by calling the installed `ask_parent` custom tool from the stub session's `prompt`; `update and question carry the launch's metadata`.
  - `test/seams/public-types.test.ts`: `SUBAGENT_EVENTS declares UPDATE and ASKED`, with `COMPLETED` unchanged.
- [ ] **Step 2: Run them; they fail.** `bun run --cwd packages/pi-subagents test -- subagent-events-observer composite-subagent-observer subagent.test launch-metadata-flow public-types`
- [ ] **Step 3: Implement.**
  - Add the two observer hooks.
  - The `askParent` lambda becomes `(question) => { this.currentRun.setPendingQuestion(question); this.execution.observer?.onQuestionAsked?.(this, question); }`.
  - The manager relays `onQuestionAsked` to `observer?.onSubagentQuestion?.(agent, question)`, the same way it relays `onUpdateSent`.
  - The events observer emits `"subagents:asked"` with `{ ...identityOf(record), question, ...launchFields(record) }`, and the update payload spreads `launchFields(record)`.
  - Add the constants.
- [ ] **Step 4: Run the tests; they pass.** Then run `bun run test:executor`; all pass.
- [ ] **Step 5: Commit** `feat(executor): emit subagents:asked and carry launch fields on subagents:update`

---

## Task 2: `SubagentsService.wait()` — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Modify: `packages/pi-subagents/src/lifecycle/subagent-run.ts` (`RunOutcome`, `SubagentRun`)
- Modify: `packages/pi-subagents/src/lifecycle/subagent.ts` (`complete`, `fail`, `endBeforeStart`, `stopQueued`, new `waitForRunEnd`)
- Modify: `packages/pi-subagents/test/lifecycle/subagent.test.ts`
- Modify: `packages/pi-subagents/src/service/service.ts` (`WaitOptions`, `SubagentsService.wait`)
- Modify: `packages/pi-subagents/src/service/service-adapter.ts` (`SubagentManagerLike.getRecord`, `wait`, `toWaitedRecord`)
- Create: `packages/pi-subagents/test/service/service-wait.test.ts`
- Modify: `packages/pi-subagents/test/lifecycle/subagent-run.test.ts`, `packages/pi-subagents/test/service/service-adapter.test.ts` (the stub manager's `getRecord` type)

**Interfaces:**
- Consumes: `SUBAGENT_EVENTS.ASKED` and the `subagents:asked` payload (Task 1).
- Produces: `WaitOptions`, `SubagentsService.wait`, `RunOutcome.question`, `SubagentRun.finished`, `Subagent.waitForRunEnd`, `toWaitedRecord` (see Contracts).

- [ ] **Step 1: Write the lifecycle tests.**
  - `subagent-run.test.ts`:
    - `keeps the recorded question readable after the run is replaced`: after `setPendingQuestion("Q")` and then `markReplaced()`, `pendingQuestion` is `undefined` and `question` is `"Q"`;
    - `finished resolves once markFinished is called, idempotently`.
  - `subagent.test.ts`, `describe("waitForRunEnd")`:
    - `returns at once for a settled run`;
    - `resolves when the run completes`;
    - `resolves when the run fails`;
    - `resolves when a queued run is stopped, without its slot opening` (schedule through a never-starting scheduler, `stopQueued()`, and expect resolution);
    - `resolves the stopped queued resume even when a terminal listener resumes again`: the observer's `onRunFinished` calls `resume()` synchronously; the first waiter resolves `stopped`, and a waiter on the new run is still pending;
    - `returns early on signal abort with the run still active`;
    - `returns the run it began on after a resume replaced it`.

  Run them; they fail.
- [ ] **Step 2: Implement.**
  - Add the `question` getter (`this._pendingQuestion`) to `SubagentRun` and `RunOutcome`.
  - Add `finished`/`markFinished` (via `Promise.withResolvers`).
  - Call `markFinished()` on the run each funnel captured, immediately after `onRunFinished`, in `complete`, `fail`, `endBeforeStart` and `stopQueued`. `stopQueued` captures `const run = this.currentRun` before calling `run.stopQueued()` and the observer.
  - Add `waitForRunEnd` (design D5).

  Run the tests; they pass.
- [ ] **Step 3: Write `test/service/service-wait.test.ts`.** Build the harness in the style of `launch-metadata-flow.test.ts`:
  - Real `SubagentsServiceAdapter`, `SubagentManager`, `ConcurrencyLimiter` and `createSubagentSession` with a factory stub session.
  - `CompositeSubagentObserver` over a real `SubagentEventsObserver`.
  - A real `NotificationManager` whose `sendMessage` pushes to `sent[]`.

  Script the stub session per test, following `test/lifecycle/subagent-session.test.ts`:
  - `io.createSession` captures `opts.customTools`;
  - `prompt` calls the captured tool's `execute()` for `notify_parent` / `ask_parent`, then pushes an assistant text message for the result, or rejects, or waits on a deferred that `session.abort` releases;
  - for the turn limit, spawn with `maxTurns: 2`, emit `turn_start`/`turn_end` events with tool results (the `programTurns` pattern) until the session's budget exhausts, and mock `sendCustomMessage` for the wrap-up warning.

  Tests (spec scenario in parentheses):
  - `resolves with completed and the result` (Background launch completes): `status === "completed"`, `result === "done"`.
  - `waits through the queue` (Queued launch): with `maxConcurrent: 0`, the promise is still pending after a microtask flush; raise the limit; it resolves `completed`.
  - `stopped while queued behind a busy slot` (Stopped while queued behind a busy slot): with `maxConcurrent: 1`, a first launch held on a deferred and a second launch waited; `abort(second)`; the wait resolves `stopped` while the first is still running.
  - `foreground service launch` (Foreground service launch).
  - `resolves at once when already settled` (Already settled).
  - `resolves with error, not rejects` (Failure): `status === "error"` and `error` is set.
  - `queued resume stopped` (Queued resume stopped): with `maxConcurrent: 1` and a busy slot, a background `resume()` stays queued; `wait(id)`; `abort(id)`; the wait resolves `stopped`.
  - `failure after ask` (Failure after a question): the run asks, then rejects; resolves `error`, no `pendingQuestion`, and one `subagents:asked` emitted.
  - `question at the turn limit` (Question at the turn limit): the stub returns an exhausted turn budget after asking; resolves `aborted` with `pendingQuestion === "Q"`.
  - `resolves stopped on abort(id)` (Stopped).
  - `resumed before the waiter reads it`: a `subagents:completed` subscriber calls `service.resume(id, "A")`. The wait resolves with the initial run's `result`, `startedAt` and `completedAt`, `pendingQuestion === "Q"`, and `resumeRefusal === "still-running"`.
  - `rejects for an unknown id` (Unknown id): rejects with a message containing `missing`.
  - `signal abort rejects and leaves the run going` (Signal aborts the wait): rejects with the reason; `getRecord(id).status === "running"`; resolving the deferred later gives `completed`.
  - `already-aborted signal on a settled run resolves` (Signal already aborted on a settled run).
  - `no nudge while waited` (No nudge while waited): `sent` has no `subagent-notification`.
  - `no update message while waited` (No update message while waited): one `subagents:update` event, and `sent` has no `subagent-update`.
  - `aborted wait gives the outcome back` (Aborted wait with no other waiter): after the abort, the run completes; `sent` has one `subagent-notification` whose content contains the update's message.
  - `concurrent waiters` (Concurrent waiters).
  - `another carrier still holds the run` (Another carrier still holds the run): a `GetResultTool` call with `wait: true` on the same id plus a service wait; abort the service wait; complete; no `subagent-notification`, and the tool returns the outcome.
  - `unwaited service launch unchanged` (Unwaited service launch unchanged): one `subagent-notification`.
  - `ask, answer, continue` (Ask, answer, continue): the first wait has `pendingQuestion === "Which config?"` and no `resumeRefusal`; `void service.resume(id, "The project one.")`, then `wait(id)` without awaiting the resume; the second wait has the resumed result and no `pendingQuestion`; the stub's last prompt is the answer; `sent` has no `subagent-notification`.
  - `marks a settled waited outcome collected`: `manager.getRecord(id).consumed === true`.
- [ ] **Step 4: Run them; they fail** (`wait` is not a function). `bun run --cwd packages/pi-subagents test -- service-wait`
- [ ] **Step 5: Implement.**
  - Add `WaitOptions` and the `wait` method to `SubagentsService`, with a doc comment covering resolution, refusals, routing while waited, the ask/answer loop, and the fact that an abort does not stop the run.
  - Implement `wait` per design D1. Use `Promise.reject` for an unknown id, not a synchronous throw. Use a never-aborting signal when none is given. Keep claim and await in one `try`, and release the claim on every non-settled exit.
  - Add `toWaitedRecord` per design D2.
- [ ] **Step 6: Run `service-wait` and `service-adapter` tests; they pass.** Then run `bun run test:executor`; all pass.
- [ ] **Step 7: Commit** `feat(executor): add SubagentsService.wait for one launch`

---

## Task 3: Host evidence — implements 3

**Covers:** 3.1, 3.2, 3.3
**Difficulty:** Normal
**Blocked by:** Task 2

**Files:**
- Create: `tests/host/probes/escalation/package.json`, `tests/host/probes/escalation/index.ts`
- Create: `tests/host/service-escalation.test.ts`
- Modify: `docs/evidence/2026-11-05-host-seams.md` (new section after "Tool assessment service lookup (WG-14)")
- Modify: `docs/testing.md` (Host level: name the new test)

**Interfaces:**
- Consumes: `SubagentsService.wait`, `resume`, `SUBAGENT_EVENTS` (Tasks 1, 2).

- [ ] **Step 1: Write the probe**, modelled on `tests/host/probes/policy/index.ts` (service lookup via `Symbol.for("@gotgenes/pi-subagents:service")`, `probeReport("escalation")`).
  - `/esc-spawn <type> <fg|bg> <wait|nowait>` spawns with `metadata: { change: "c1" }` and the fixed prompt `CHILD-TASK escalate`. With `wait`, it calls `wait(id)` without awaiting it inside the command, then records `wait:resolved` with `{ status, hasQuestion, hasRefusal }`, or `wait:rejected`.
  - On every `subagents:completed`, record `snapshot` with `{ id, status, hasQuestion, hasRefusal }` from `getRecord(id)`, for the unwaited branch.
  - `/esc-resume <id>` calls `resume(id, "ANSWER-TEXT")` without awaiting it, then `wait(id)`, and records `wait2:resolved` with `{ status, resultIsFinal }`.
  - It subscribes to `subagents:update` / `asked` / `completed` and records `{ ch, id, meta }`.
  - Its `message_end` handler records each main-session message `customType`.
  - Record no text.
- [ ] **Step 2: Write `service-escalation.test.ts`.** The fixture script follows the throwaway probe in brainstorm.md:
  - the child calls `notify_parent`, then `ask_parent`, then answers `asked`;
  - after the answer, it answers `final`;
  - the main model answers `done`.

  Tests:
  - `unwaited launch escalates to the main session: background` and `...: foreground` (Unwaited service launch escalates to the main session);
  - `waited launch escalates to the caller only: background` and `...: foreground` (Waited service launch escalates to the caller only);
  - `caller answers` (Caller answers): the child request after the resume contains `ANSWER-TEXT`, `wait2:resolved` has `resultIsFinal: true`, and no `subagent-notification` reached the main session.

  Assertions in each foreground and background test:
  - `subagents:update` and `subagents:asked` were each recorded once, with `meta: true`;
  - unwaited: one `subagent-update` and one `subagent-notification` main-session message, and `snapshot` is `{ status: "completed", hasQuestion: true, hasRefusal: false }`;
  - waited: zero of each message type, and `wait:resolved` is `{ status: "completed", hasQuestion: true, hasRefusal: false }`.
- [ ] **Step 3: Run** `bun test tests/host/service-escalation.test.ts`; all pass. If an observed value differs from the spec, stop and report; do not adjust the expectation.
- [ ] **Step 4: Write the evidence section** "Service launch escalation". Cover:
  - observed behaviour without and with `wait()`, foreground and background;
  - the test file, testing level Host, and the Pi and executor versions (read them from `node_modules/@earendil-works/pi-coding-agent/package.json` and `packages/pi-subagents/package.json`);
  - Limits;
  - Documents changed.

  Add the test to the Host paragraph of `docs/testing.md`.
- [ ] **Step 5: Commit** `test(host): pin service launch escalation with and without wait`

---

## Task 4: Records, generated types and docs — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4, 4.5
**Difficulty:** Easy
**Blocked by:** Task 2

**Files:**
- Modify: `packages/pi-subagents/VENDORED.md`
- Modify: `packages/pi-subagents/dist/public.d.ts` (generated)
- Modify: `packages/pi-subagents/README.md` (`spawn` contract near line 400; Events table near line 322)
- Modify: `docs/decisions/0009-vendored-executor.md` (seam list near line 17)

**Interfaces:**
- Consumes: the public contracts of Tasks 1 and 2.

- [ ] **Step 1: Add `VENDORED.md` rows.**
  - Extend the existing rows for `src/service/service.ts`, `src/service/service-adapter.ts`, `src/lifecycle/subagent.ts`, `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent-run.ts`, `src/observation/subagent-events-observer.ts` and `src/observation/composite-subagent-observer.ts`, adding rows where a file has none.
  - Add rows for `test/service/service-wait.test.ts` and every edited upstream test file.
  - Run `bun test tests/vendoring.test.ts`; it passes.
- [ ] **Step 2: Regenerate the public types.** Run `bun run --cwd packages/pi-subagents build:types`, then `bun run --cwd packages/pi-subagents verify:public-types`; it passes, and `dist/public.d.ts` contains `WaitOptions` and `wait(`.
- [ ] **Step 3: Update the README.**
  - Add a `#### wait contract` after the `spawn` contract. It covers: resolves at the run's terminal status with that run's snapshot; already settled resolves at once; unknown id rejects; signal abort rejects without stopping the run; while waited, no completion or update message reaches the main session; ask → `pendingQuestion` → `resume(id, answer)` → `wait(id)`.
  - Change the `spawn` contract line "Use `getRecord(id)` to poll ..." to name `wait(id)`.
  - Add Events rows: `subagents:update` (`id`, `type`, `description`, `message`, `metadata`) and `subagents:asked` (`id`, `type`, `description`, `question`, `metadata`).
- [ ] **Step 4: Update `0009-vendored-executor.md`.** Add the line "a per-launch wait for service launches and a question event".
- [ ] **Step 5: Run the full checks:** `bun run test`, `bun run test:executor`, `bun run lint`, `bun run typecheck`; all pass.
- [ ] **Step 6: Commit** `docs(executor): record wait contract, question event and vendored rows`

---

## Scenario → test

**service-launch-wait**
- Background launch completes → `service-wait.test.ts` › `resolves with completed and the result`
- Queued launch → `service-wait.test.ts` › `waits through the queue`
- Foreground service launch → `service-wait.test.ts` › `foreground service launch`; host `waited launch escalates to the caller only: foreground`
- Already settled → `service-wait.test.ts` › `resolves at once when already settled`
- Failure → `service-wait.test.ts` › `resolves with error, not rejects`
- Stopped → `service-wait.test.ts` › `resolves stopped on abort(id)`
- Queued resume stopped → `service-wait.test.ts` › `queued resume stopped`; `subagent.test.ts` › `waitForRunEnd resolves the stopped queued resume even when a terminal listener resumes again`
- Stopped while queued behind a busy slot → `service-wait.test.ts` › `stopped while queued behind a busy slot`; `subagent.test.ts` › `waitForRunEnd resolves when a queued run is stopped, without its slot opening`
- Resumed before the waiter reads it → `service-wait.test.ts` › `resumed before the waiter reads it`
- Unknown id → `service-wait.test.ts` › `rejects for an unknown id`
- Signal aborts the wait → `service-wait.test.ts` › `signal abort rejects and leaves the run going`
- Signal already aborted on a settled run → `service-wait.test.ts` › `already-aborted signal on a settled run resolves`
- No nudge while waited → `service-wait.test.ts` › `no nudge while waited`
- No update message while waited → `service-wait.test.ts` › `no update message while waited`
- Unwaited service launch unchanged → `service-wait.test.ts` › `unwaited service launch unchanged`
- Aborted wait with no other waiter → `service-wait.test.ts` › `aborted wait gives the outcome back`
- Concurrent waiters → `service-wait.test.ts` › `concurrent waiters`
- Another carrier still holds the run → `service-wait.test.ts` › `another carrier still holds the run`
- Ask, answer, continue → `service-wait.test.ts` › `ask, answer, continue`; host `caller answers`
- Question at the turn limit → `service-wait.test.ts` › `question at the turn limit`
- Failure after a question → `service-wait.test.ts` › `failure after ask`
- Service launch with metadata asks → `launch-metadata-flow.test.ts` › `subagents:asked precedes subagents:completed for a service launch`
- Tool-call launch asks → `subagent-events-observer.test.ts` › `emits subagents:asked with id, type, description, question` (`toolCallId` case)
- Constants declared → `SUBAGENT_EVENTS declares UPDATE and ASKED`

**launch-metadata** (MODIFIED)
- Queued record → `launch-metadata-flow.test.ts` › `Queued record`
- Every record event of a launch with metadata → `launch-metadata-flow.test.ts` › `Every record event of a launch with metadata`
- Failure → `launch-metadata-flow.test.ts` › `Failure`
- Record events without metadata → `launch-metadata-flow.test.ts` › `Record events without metadata`
- Tool-call resume of a service launch → `launch-metadata-flow.test.ts` › `Tool-call resume of a service launch`
- Update and question of a launch with metadata → `launch-metadata-flow.test.ts` › `update and question carry the launch's metadata`
- Update without metadata → `subagent-events-observer.test.ts` › `onSubagentUpdate omits them when absent`

**executor-launch-identity** (MODIFIED)
- Completion of a tool-call launch → `identity.test.ts` › `completion carries the launching tool call`
- Resume from a tool call → `identity.test.ts` › `resume carries the resuming call, not the spawning one`
- Update from a tool-call launch → `subagent-events-observer.test.ts` › `onSubagentUpdate adds toolCallId and metadata from the launch`
- Update from a service launch → `subagent-events-observer.test.ts` › `onSubagentUpdate omits them when absent`

**host-seam-evidence**
- Unwaited service launch escalates to the main session → `tests/host/service-escalation.test.ts` › `unwaited launch escalates to the main session: background` / `: foreground`
- Waited service launch escalates to the caller only → `tests/host/service-escalation.test.ts` › `waited launch escalates to the caller only: background` / `: foreground`
- Caller answers → `tests/host/service-escalation.test.ts` › `caller answers`
