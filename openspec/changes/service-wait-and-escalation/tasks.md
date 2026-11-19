## 1. Question event and launch fields on updates

Blocked by: none

- [x] 1.1 `src/lifecycle/subagent.ts`: add `onQuestionAsked?(agent, question)` to the record observer; the `askParent` recorder in `run()` calls it after `setPendingQuestion` (design D3)
- [x] 1.2 `src/lifecycle/subagent-manager.ts` and `src/observation/composite-subagent-observer.ts`: relay it as `SubagentManagerObserver.onSubagentQuestion?`
- [x] 1.3 `src/observation/subagent-events-observer.ts`: emit `subagents:asked` with `{ id, type, description, question, ...launchFields(record) }`, no persistence, no notification; add `...launchFields(record)` to `subagents:update` (design D3, D4)
- [x] 1.4 `src/service/service.ts`: add `UPDATE` and `ASKED` to `SUBAGENT_EVENTS` (design D6)
- [x] 1.5 Tests: observer payloads for `subagents:asked` and `subagents:update` with and without `toolCallId`/`metadata`; the asked-before-completed order through a real `Subagent`; the constants

## 2. `SubagentsService.wait()`

Blocked by: 1

- [x] 2.1 `src/lifecycle/subagent-run.ts` and `src/lifecycle/subagent.ts`: expose the question a run ended with, even after it was replaced (`RunOutcome.question`, design D2); add the run's `finished` promise, resolved in every terminal funnel, and `Subagent.waitForRunEnd(signal)` (design D5)
- [x] 2.2 `src/service/service.ts`: add `WaitOptions` and `SubagentsService.wait(id, options?)` with its contract doc
- [x] 2.3 `src/service/service-adapter.ts`: implement `wait()` over the concrete `Subagent` that `SubagentManagerLike.getRecord` already returns: unknown id rejects; claim; `waitForRunEnd`; settled → mark consumed, keep the claim, resolve with the snapshot overlaid with the waited run's outcome; aborted → release this call's claim, reject with `signal.reason` (design D1, D2)
- [x] 2.4 Tests in `test/service/`: every scenario of `specs/service-launch-wait` that does not need a real Pi session, driven through the real adapter, manager and notification system with stub sessions (no nudge while waited, aborted wait gives the outcome back, concurrent waiters, another carrier still holds the run, queued launch, stopped while queued behind a busy slot, queued resume stopped, failure, stop, ask/answer/continue, question at the turn limit, failure after a question, resumed before read, unknown id, signals)

## 3. Host evidence

Blocked by: 2

- [ ] 3.1 Add the probe extension `tests/host/probes/escalation/`: `/esc-spawn <type> <fg|bg> <wait|nowait>`, `/esc-resume <id>`; records event names, ids, statuses, whether metadata is present and the main-session `customType`s, never prompt text
- [ ] 3.2 Add `tests/host/service-escalation.test.ts` covering the three scenarios of `specs/host-seam-evidence`, in foreground and background
- [ ] 3.3 Add a "Service launch escalation" section to `docs/evidence/2026-11-05-host-seams.md` with the observed answers, test, testing level and versions; list the test in `docs/testing.md`

## 4. Records, generated types and docs

Blocked by: 2

- [ ] 4.1 `VENDORED.md` rows for every edited upstream file and the new test files
- [ ] 4.2 Regenerate `dist/public.d.ts` (`bun run --cwd packages/pi-subagents build:types`) and run `verify:public-types`
- [ ] 4.3 `packages/pi-subagents/README.md`: a `wait` contract next to the `spawn` contract (resolution, refusals, routing while waited, ask/answer loop); add `subagents:update` and `subagents:asked` rows to the Events table, with `metadata`
- [ ] 4.4 `docs/decisions/0009-vendored-executor.md`: add the per-launch wait and the question event to the seam list
- [ ] 4.5 Run `bun run test`, `bun run test:executor`, `bun run lint` and `bun run typecheck`; all pass
