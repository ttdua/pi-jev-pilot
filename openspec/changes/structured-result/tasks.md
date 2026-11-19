## 1. Result schema seam

Blocked by: none

- [x] 1.1 Add `packages/pi-subagents/src/seams/result-schema.ts` with `parseResultSchema(input)`: subset check (`type`, `enum`, `properties`, `items`, `required`, `additionalProperties`, annotations `title`, `description`, `$schema` draft 2020-12 only), root `type` required, errors naming keyword and JSON Pointer, returns a frozen deep copy (specs: "Result schema on service launches", "Refused result schemas", "Result schema annotations", "Result schema is copied at spawn")
- [x] 1.2 Add `validateResult(schema, value)` returning every `{ path, message }` violation, with `integer` as `Number.isInteger` (specs: "Submitted result is validated in the child", "Integer type")
- [x] 1.3 Unit tests in `packages/pi-subagents/test/seams/result-schema.test.ts` covering each accepted keyword, each refusal, mutation after parse, and every validator scenario

## 2. Submit result tool and per-run outcome

Blocked by: 1

- [x] 2.1 Add `packages/pi-subagents/src/session/submit-result-tool.ts`: wrapped `{ result: <schema> }` parameters, re-validation in `execute`, error result with paths, `terminate: true` on success, "already submitted" error on a second call (specs: "Submit result tool", "Submitted result is validated in the child", "First valid submission is final")
- [x] 2.2 `SubagentRun` (`src/lifecycle/subagent-run.ts`): per-run `structuredResult`, submit-attempt flag and `structuredResultError` settled at completion, failure and abort; none for a run stopped while queued or ending on a pending question (specs: "Structured outcome per run", "Structured result error kinds")
- [x] 2.3 `create-subagent-session.ts`: install `submit_result` in `buildChildTools()` when a schema is passed, exempt it from `disallowed` and policy `removed` in `freshSetup` (spec: "Submit result tool cannot be removed")
- [x] 2.4 `subagent-session.ts`: count `submit_result` attempts from `tool_execution_start`, and end the run at the completed-turn boundary through a composed `session.agent.finishTurn` once the run holds a structured result (spec: "Valid submission ends the run")
- [x] 2.5 `subagent.ts`: carry `resultSchema` in the execution config, wire the tool to the current run, and settle a run holding a structured result `completed` despite an `exhausted` budget while keeping an external `stopped` (spec: "Valid submission ends the run")
- [x] 2.6 Tests: `test/session/submit-result-tool.test.ts`, plus additions to `test/lifecycle/subagent-run.test.ts`, `create-subagent-session.test.ts`, `subagent-session.test.ts` and `subagent.test.ts` for every scenario of the requirements above, including resume and turn-limit cases

## 3. Service surface, records, events and policy

Blocked by: 2

- [x] 3.1 `src/service/service.ts`: `SpawnOptions.resultSchema`, `SubagentRecord.structuredResult` and `structuredResultError`, with doc comments
- [x] 3.2 `src/service/service-adapter.ts` `spawn()`: parse the schema first, refuse a resolved `fork` before anything is created, pass the schema through `AgentSpawnConfig` in `subagent-manager.ts`; snapshot copies both fields when set (specs: "Refused result schemas", "Structured outcome on records and events")
- [x] 3.3 `src/observation/notification.ts` `buildEventData()`: add both fields when set, so `subagents:completed`, `failed` and `resumed` carry them; `persisted-record.ts` unchanged (spec: "Structured outcome on records and events")
- [x] 3.4 `src/seams/launch-request.ts`: add `submit_result` to `OWNED_TOOLS` (executor-launch-policy delta)
- [x] 3.5 Tests: `test/service/service-adapter.test.ts` (refusals, policy not called, snapshot fields), `test/seams/launch-policy.test.ts` (parentTools exclusion), event payload and persisted-entry tests, and one end-to-end flow test in `test/seams/` driving spawn → submit → `subagents:completed`

## 4. Docs and vendoring records

Blocked by: 3

- [ ] 4.1 `packages/pi-subagents/README.md`: `resultSchema` in the `spawn` contract (subset, refusals, fork rule), `submit_result`, the two record fields and the Events table
- [ ] 4.2 `docs/architecture.md` seams line and `docs/decisions/0009-vendored-executor.md` seam list name the result schema
- [ ] 4.3 `packages/pi-subagents/VENDORED.md` rows for every edited or added upstream file; regenerate `dist/public.d.ts` and pass `verify:public-types`
- [ ] 4.4 Run `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun test` at the repo root and the executor's `lint`/`lint:md`; all pass
