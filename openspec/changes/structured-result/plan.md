# Structured Result Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`structured-result`, `executor-launch-policy`) and `design.md`.

**Goal:** A service launch can pass `resultSchema` and get a child-validated `structuredResult` (or `structuredResultError`) on its record and terminal events, through a `submit_result` child protocol tool.

**Architecture:** A pure seam (`seams/result-schema.ts`) checks the schema subset and validates values. A child protocol tool (`session/submit-result-tool.ts`) stores a valid value on the current `SubagentRun`, which derives the per-run error kind. The turn loop stops a run that holds a result; `Subagent.complete()` lets a held result win over turn-budget exhaustion. The service adapter refuses bad schemas and forks before anything is created, and the snapshot and event payload expose the two fields.

**Tech Stack:** TypeScript, vitest (vendored executor `packages/pi-subagents/`), Pi `defineTool`, Bun at the repo root.

## Global Constraints

- No new dependency; validation is the executor's own code.
- Public Pi APIs only. Never persist tool arguments: `persisted-record.ts` is not touched.
- Launches without `resultSchema` keep today's tools, tool counts, events and record shape exactly.
- Public repository: code, comments, docs and commits in English.
- Tests need no secrets, paid calls or network beyond loopback.
- Every edited or added upstream file gets a row in `packages/pi-subagents/VENDORED.md`.

## Review Focus

- A schema object with cycles or shared sub-objects passed to `spawn` → `parseResultSchema` must not hang or crash; a cycle throws a clear error (test in Task 1).
- A schema whose `required` names a property not in `properties` → accepted (valid JSON Schema), and validation requires the property anyway (test in Task 1).
- `submit_result` with a falsy valid value (`false`, `0`, `""`) → stored and reported as a structured result, not as missing (test in Task 2).
- A resume of a record whose launch had a schema reuses the live session → the tool writes to the resumed run, not the settled one (test in Task 2).
- `structuredResult` objects exposed on the snapshot and events → a consumer mutating them cannot change the record (frozen deep copy; test in Task 3).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `ResultSchema` | new | `type ResultSchema = Readonly<{ type?: "object" \| "array" \| "string" \| "number" \| "integer" \| "boolean"; enum?: readonly (string \| number \| boolean)[]; properties?: Readonly<Record<string, ResultSchema>>; items?: ResultSchema; required?: readonly string[]; additionalProperties?: boolean \| ResultSchema; title?: string; description?: string; $schema?: "https://json-schema.org/draft/2020-12/schema" }>` in `src/service/service.ts` | public |
| `StructuredResultError` | new | `type StructuredResultError = "missing" \| "invalid"` in `src/service/service.ts` | public |
| `SpawnOptions.resultSchema` | modified | `resultSchema?: ResultSchema` | public |
| `SubagentRecord.structuredResult` / `.structuredResultError` | modified | `structuredResult?: unknown` (deep-frozen JSON value); `structuredResultError?: StructuredResultError` | public |
| `subagents:completed` / `failed` / `resumed` payload | modified | adds `structuredResult?` and `structuredResultError?`, omitted when unset | public |
| `parseResultSchema` | new | `parseResultSchema(input: unknown): ResultSchema \| undefined` — `undefined` for `undefined` input; throws `Error` naming keyword and JSON Pointer otherwise | internal |
| `validateResult` | new | `validateResult(schema: ResultSchema, value: unknown): ResultViolation[]`, `interface ResultViolation { path: string; message: string }`, `path` dotted from `result` (e.g. `result.status`, `result.items.0`) | internal |
| `SubmitResultTool` | new | `new SubmitResultTool(schema: ResultSchema, sink: StructuredResultSink)`, `toToolDefinition()`; `interface StructuredResultSink { hasResult(): boolean; submit(value: unknown): "stored" \| "already-submitted" }` (`hasResult` lets the tool answer "already submitted" before validating, as the "First valid submission is final" requirement needs); `SUBMIT_RESULT_TOOL_NAME = "submit_result"` | internal |
| `SubagentRun` structured API | modified | ctor init gains `expectsStructuredResult?: boolean`; `submitStructuredResult(value: unknown): "stored" \| "already-submitted"`; `recordSubmitAttempt(): void`; getters `hasStructuredResult: boolean`, `structuredResult: unknown`, `structuredResultError: StructuredResultError \| undefined` (derived: only when expected, terminal, not stopped-while-queued, no value, and the run's own `_pendingQuestion` unset — never the `pendingQuestion` accessor, which is masked once the run is replaced) | internal |
| `Subagent.structuredResult` / `.structuredResultError` | new | getters delegating to `currentRun` | internal |
| `CreateSubagentSessionParams.resultSchema` / `.submitResult` | modified | `resultSchema?: ResultSchema; submitResult?: StructuredResultSink` (object sink, see `SubmitResultTool`) — both or neither | internal |
| `TurnLoopOptions` | modified | adds `onSubmitAttempt?: () => void; hasStructuredResult?: () => boolean`; the turn loop installs one composed `session.agent.finishTurn` wrapper on every run, shared by the structured-result end and the turn-budget end (no-op within budget without a held result; previous hook first; `end` when it returns end, else `{ action: "end" }` when `hasStructuredResult()` or the budget is spent), and also calls `session.abort()` unawaited at that completed-turn boundary (`AgentSession` would otherwise continue for queued steer/follow-up; the run's own abort signal is untouched, so it settles `completed`, and an external abort still reads `stopped`), restoring the previous hook in `finally` | internal |
| `SubagentExecution.resultSchema`, `AgentSpawnConfig.resultSchema` | modified | `resultSchema?: ResultSchema` | internal |
| `OWNED_TOOLS` | modified | adds `"submit_result"` | internal |

---

## Task 1: Result schema seam — implements 1

**Covers:** 1.1, 1.2, 1.3
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/src/seams/result-schema.ts`
- Modify: `packages/pi-subagents/src/service/service.ts` (types `ResultSchema`, `StructuredResultError` only)
- Test: `packages/pi-subagents/test/seams/result-schema.test.ts`

**Interfaces:** Produces `ResultSchema`, `StructuredResultError`, `parseResultSchema`, `validateResult`, `ResultViolation` (Contracts).

- [ ] **Step 1: Write failing tests** in `result-schema.test.ts`:
  - `parseResultSchema(undefined)` → `undefined`.
  - accepts the issue example `{ type: "object", properties: { status: { enum: ["done", "blocked"] } }, required: ["status"], additionalProperties: false }`; result `Object.isFrozen` deep, and `!==` input.
  - mutating the input's `enum` after parse leaves the parsed copy unchanged.
  - throws `/minimum.*\/properties\/n\/minimum/` for `{ type: "object", properties: { n: { type: "number", minimum: 0 } } }`.
  - throws `/type/` for `{ properties: {} }` (no root type) and for `{ type: "null" }`, `{ type: ["string"] }`.
  - throws `/\$schema/` for `$schema: "http://json-schema.org/draft-07/schema#"`; accepts the 2020-12 URI plus `title`/`description`.
  - throws for non-plain objects (array, class instance, `null`) at root and nested, for empty `enum`, non-scalar `enum` member, duplicate `required`.
  - throws `/cycle/i` for a self-referencing `properties`; accepts a sub-schema object shared by two properties (not a cycle).
  - table-driven wrong-shape refusals, each naming keyword and pointer: `items` array or non-object, `properties` non-object or a non-object member, `required` non-array or non-string member, `additionalProperties` neither boolean nor object, `title`/`description` non-string.
  - pointer escaping: a property named `a/b~c` with a bad keyword → pointer `/properties/a~1b~0c/...`.
  - `validateResult` type matrix: each of the six types accepts its kind and rejects the other kinds (`object` rejects arrays and `null`; `number` rejects `NaN`/`Infinity`); a nested schema without `type` accepts any value that meets its other keywords.
  - `validateResult`: enum miss → one violation `{ path: "result.status" }` whose message lists `done`, `blocked`; extra property with `additionalProperties: false` → path `result.note`; `integer` rejects `1.5`, accepts `3`; `required` missing → path `result.status`; `required` naming an undeclared property still enforced; `items` violation path `result.0`; nested `additionalProperties` schema applied; valid value → `[]`; multiple violations all reported.
- [ ] **Step 2: Run** `bun run --cwd packages/pi-subagents test -- test/seams/result-schema.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** `parseResultSchema` and `validateResult` in `src/seams/result-schema.ts`, and the two types in `service.ts`. Recursive walk with a `WeakSet` ancestor stack for cycles; JSON Pointer built from keys (`/properties/<name>/…`, `/items`, `/additionalProperties`); plain object = prototype `Object.prototype` or `null`. `type` checks: `object` = plain object, `array` = `Array.isArray`, `number` = finite number, `integer` = `Number.isInteger`.
- [ ] **Step 4: Run** the same command → PASS; `bun run --cwd packages/pi-subagents check` → no errors.
- [ ] **Step 5: Commit** `feat(pi-subagents): result schema subset and validator`.

---

## Task 2: Submit result tool and per-run outcome — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Create: `packages/pi-subagents/src/session/submit-result-tool.ts`
- Modify: `packages/pi-subagents/src/lifecycle/subagent-run.ts`, `src/lifecycle/create-subagent-session.ts` (`CreateSubagentSessionParams`, `buildChildTools`, `freshSetup`), `src/lifecycle/subagent-session.ts` (`TurnLoopOptions`, `promptForAnswer`, `enforceTurnBudget`, new private `endRunOnStructuredResult`), `src/lifecycle/subagent.ts` (`SubagentExecution`, `run()`, `runOnSession()`, `complete()`, resume run creation)
- Test: `packages/pi-subagents/test/session/submit-result-tool.test.ts`; additions to `test/lifecycle/subagent-run.test.ts`, `test/lifecycle/create-subagent-session.test.ts`, `test/lifecycle/subagent-session.test.ts`, `test/lifecycle/subagent.test.ts`; new `test/lifecycle/structured-result-loop.test.ts`

**Interfaces:** Consumes Task 1 contracts. Produces `SubmitResultTool`, `StructuredResultSink`, the `SubagentRun` structured API, `CreateSubagentSessionParams.resultSchema/submitResult`, `TurnLoopOptions` additions, `SubagentExecution.resultSchema`.

- [ ] **Step 1: Tool tests** (`submit-result-tool.test.ts`, pattern of `ask-parent-tool.test.ts`):
  - definition name `submit_result`; `parameters` deep-equals `{ type: "object", properties: { result: schema }, required: ["result"], additionalProperties: false }`; description tells the child to call it once with its final result before finishing.
  - invalid value → `isError: true`, text contains `result.status` and `done`, sink not called.
  - valid value → sink called with it, result `terminate: true`, not error.
  - sink returns `"already-submitted"` → `isError: true`, text says a result was already submitted.
  - falsy valid values `false`, `0`, `""` reach the sink.
  - coercion contract: with schema `{ type: "integer" }`, call `validateToolArguments(definition, { type: "toolCall", id: "tc-1", name: "submit_result", arguments: { result: "42" } })` from `@earendil-works/pi-ai` (existing devDependency), pass its return value to `execute`; the sink receives the number `42`.
- [ ] **Step 2: Run tests** → FAIL. **Implement** `SubmitResultTool` → PASS.
- [ ] **Step 3: Run tests** (`subagent-run.test.ts`): run with `expectsStructuredResult: true`:
  - running → both getters undefined; `submitStructuredResult(x)` → `"stored"`, second → `"already-submitted"`, value unchanged.
  - completed with no attempt → `structuredResultError` `"missing"`; after `recordSubmitAttempt()` only → `"invalid"`; with a value after an attempt → error undefined, `hasStructuredResult` true.
  - pending question and no value → both undefined, also after an invalid attempt; still both undefined after `markReplaced()`.
  - `markAborted`, `markError`, `markStopped` with no value → error set; `stopQueued` → undefined.
  - `expectsStructuredResult` false/omitted → error always undefined.
  - stored value is deep-frozen (`structuredClone` then freeze).
- [ ] **Step 4: Run** → FAIL. **Implement** in `subagent-run.ts` (derived getter, no settle step) → PASS.
- [ ] **Step 5: Session assembly tests** (`create-subagent-session.test.ts`):
  - schema + sink → active tools include `submit_result`; no schema → tool list identical to today (existing assertions unchanged).
  - `disallowedTools: ["submit_result"]` → tool still present.
  - `tools: read`, `askParent`, schema, no `notifyParent` → `onToolFacts` reports `toolCount` 3.
  - fork context never installs it (existing fork tests extended with a schema param: no `submit_result`).
- [ ] **Step 6: Run** → FAIL. **Implement**: `buildChildTools` pushes `new SubmitResultTool(params.resultSchema, params.submitResult)` when both are set; `freshSetup` filters `submit_result` out of `input.disallowed` before `finalToolNames` only when the launch has a `resultSchema` (without one the name is an ordinary tool and policy applies) (protocol tools are appended after the policy-adjusted base tools, so a policy removal never reaches them; Task 3 pins that through the real policy path). → PASS.
- [ ] **Step 7: Turn loop tests.** In `subagent-session.test.ts` (mock session from `test/helpers/mock-session.ts`): `tool_execution_start` with `toolName: "submit_result"` calls `onSubmitAttempt` once per call, other tools do not; `session.agent.finishTurn` is wrapped during the loop, returns `{ action: "end" }` only when `hasStructuredResult()` is true, defers to a previous hook's `end`, and is restored after the loop (also when the prompt throws). In new `structured-result-loop.test.ts`: a real child built by `createSubagentSession` over `createAgentSession` and a loopback HTTP provider scripted per request, following `test/lifecycle/fresh-prompt.test.ts` (no direct `pi-agent-core` import; it is not a package dependency), driven by `SubagentSession.runTurnLoop` with the hooks `Subagent` passes:
  - turn 1 calls only a valid `submit_result` → exactly 1 provider request.
  - turn 1 calls `read` and a valid `submit_result` → both tool results emitted, exactly 1 provider request.
  - turn 1 calls an invalid `submit_result` → a 2nd request happens (the child can retry).
- [ ] **Step 8: Run** → FAIL. **Implement**: attempt counting inside the existing `enforceTurnBudget` subscription (no new subscription); `endRunOnStructuredResult(hasResult)` installs the `finishTurn` wrapper around `session.prompt` in `promptForAnswer` and restores it in `finally`. → PASS.
- [ ] **Step 9: Subagent tests** (`subagent.test.ts`, `make-subagent` helpers):
  - execution with `resultSchema` → factory receives `resultSchema` and a `submitResult` sink; calling the sink stores on `currentRun`; without schema → neither passed.
  - a turn loop result with `turnBudget.phase: "exhausted"` and a stored value → status `completed`, for a submit-alone and a mixed-batch final turn; without a value → `aborted` (unchanged).
  - `abort()` after a stored value → status `stopped`, `structuredResult` kept.
  - resume: first run ends with a pending question; resume run created with `expectsStructuredResult: true`; sink called during the resume stores on the resume run; the settled run keeps none.
  - resumed run starts with both fields undefined even when the previous run had `"missing"`.
  - holding a reference to the first run (ended on a question after an invalid attempt), resume it: the old run's `structuredResultError` stays undefined.
- [ ] **Step 10: Run** → FAIL. **Implement**: `SubagentExecution.resultSchema`; both `new SubagentRun(...)` sites pass `expectsStructuredResult: execution.resultSchema !== undefined`; sink `(value) => this.currentRun.submitStructuredResult(value)`; `runOnSession` passes `onSubmitAttempt: () => run.recordSubmitAttempt()` and `hasStructuredResult: () => run.hasStructuredResult`; `complete()` uses `exhausted && !run.hasStructuredResult` for `aborted`. → PASS.
- [ ] **Step 11: Run** `bun run --cwd packages/pi-subagents check && bun run --cwd packages/pi-subagents test` → all PASS.
- [ ] **Step 12: Commit** `feat(pi-subagents): submit_result tool and per-run structured outcome`.

---

## Task 3: Service surface, records, events and policy — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4, 3.5
**Difficulty:** Normal
**Blocked by:** Task 2

**Files:**
- Modify: `packages/pi-subagents/src/service/service.ts` (`SpawnOptions`, `SubagentRecord`), `src/service/service-adapter.ts` (`spawn`, snapshot builder), `src/lifecycle/subagent-manager.ts` (`AgentSpawnConfig`, execution build in `create()`), `src/lifecycle/subagent.ts` (getters `structuredResult`, `structuredResultError` delegating to `currentRun`), `src/observation/notification.ts` (`buildEventData`), `src/seams/launch-request.ts` (`OWNED_TOOLS`)
- Test: `test/service/service-adapter.test.ts`, `test/seams/launch-policy.test.ts`, `test/observation/notification.test.ts`, `test/observation/subagent-events-observer.test.ts`, `test/persisted-record.test.ts`, new `test/seams/structured-result-flow.test.ts`

**Interfaces:** Consumes Task 1 and 2 contracts. Produces `AgentSpawnConfig.resultSchema`, the `Subagent` getters, the public `SpawnOptions.resultSchema`, `SubagentRecord` fields and event payload fields.

- [ ] **Step 1: Adapter tests** (`service-adapter.test.ts`):
  - unsupported keyword → throws naming `minimum`; `listAgents()` unchanged; registered policy not called; thrown before the no-session check (works with no `currentCtx`).
  - `context: "fork"` + schema → throws `/resultSchema.*fork|fork.*resultSchema/`; agent file `context: fork` (unlocked, no caller context) + schema → same; locked fork agent + caller `fresh` + schema → same.
  - valid schema → manager `spawn` receives `resultSchema` (frozen copy).
  - snapshot: `structuredResult` and `structuredResultError` copied when set, absent otherwise.
- [ ] **Step 2: Run** → FAIL. **Implement** in `service-adapter.ts`: `const resultSchema = parseResultSchema(options?.resultSchema)` right after `parseLaunchMetadata`; after `resolveContext`, `if (resultSchema && context === "fork") throw new Error("resultSchema cannot be used with context \"fork\": ...")`; pass through `AgentSpawnConfig` → `SubagentExecution`; snapshot copies the fields. → PASS.
- [ ] **Step 3: Policy and event tests:**
  - `launch-policy.test.ts`: parent tools `read`, `ask_parent`, `submit_result` → `toolSet.parentTools` equals `["read"]`.
  - `launch-policy.test.ts`: a real registered policy returning `removeTools: ["submit_result"]` for a launch with a schema → the child's active tools still include `submit_result`.
  - `notification.test.ts` `buildEventData`: fields present only when set; `subagent-events-observer.test.ts`: `subagents:completed`, `failed` and `resumed` payloads carry them, and a launch without a schema has neither key.
  - `persisted-record.test.ts`: a record with a structured result → persisted entry has neither field.
- [ ] **Step 4: Run** → FAIL. **Implement** `OWNED_TOOLS` and `buildEventData` additions → PASS.
- [ ] **Step 5: Flow test** `test/seams/structured-result-flow.test.ts`, modelled on `launch-metadata-flow.test.ts`: service `spawn` with a schema; the fake child calls the installed `submit_result` with an invalid then a valid value; assert the invalid call's error text, `subagents:completed` payload `structuredResult` `{ status: "done" }`, `getRecord(id).structuredResult` deep-equal, frozen; a second launch whose child never calls the tool → `subagents:completed` payload has `structuredResultError` `"missing"` and no `structuredResult` key; a third launch: mutate the caller's schema `enum` after `spawn` returns, then the child submits the added value → the tool returns an error.
- [ ] **Step 6: Run** `bun run --cwd packages/pi-subagents check && bun run --cwd packages/pi-subagents test` → PASS.
- [ ] **Step 7: Commit** `feat(pi-subagents): resultSchema on spawn with structured record and events`.

---

## Task 4: Docs and vendoring records — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4
**Difficulty:** Easy
**Blocked by:** Task 3

**Files:**
- Modify: `packages/pi-subagents/README.md` (spawn contract near "Launch metadata", Events table rows `completed`/`failed`/`resumed`, record fields), `docs/architecture.md` (seams line ~183), `docs/decisions/0009-vendored-executor.md` (seam list), `packages/pi-subagents/VENDORED.md`, `packages/pi-subagents/dist/public.d.ts` (regenerated)

- [ ] **Step 1:** README: a "Structured results" subsection under the spawn contract: the subset, refusals (unsupported keyword, missing root type, fork), `submit_result` behaviour (validation errors returned, first valid result final, run ends after the turn, cannot be removed), per-run fields and their meaning, not persisted; Events table adds both fields to `completed`/`failed`/`resumed`.
- [ ] **Step 2:** `docs/architecture.md` and ADR 0009 seam lists add "structured child results (`resultSchema`, `submit_result`)".
- [ ] **Step 3:** `VENDORED.md` rows for every file touched in Tasks 1–3 (new files as `add`), following the existing row format.
- [ ] **Step 4:** Regenerate public types per `packages/pi-subagents/scripts/verify-public-types.sh`, then `bun run --cwd packages/pi-subagents verify:public-types` → PASS.
- [ ] **Step 5: Run** from repo root: `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun test`, and `bun run --cwd packages/pi-subagents lint && bun run --cwd packages/pi-subagents lint:md` → all PASS (`test/readme-contract.test.ts` included).
- [ ] **Step 6: Commit** `docs(pi-subagents): document structured results`.

---

## Task 5: Turn-limit stop settles aborted — implements 5

**Covers:** 5.1, 5.2
**Difficulty:** Normal
**Blocked by:** Task 4

Added during verify iteration 1 (user-approved scope addition): a real provider session that reaches its turn limit settled `error` ("This operation was aborted") instead of `aborted`, with or without a schema.

**Files:**
- Modify: `packages/pi-subagents/src/lifecycle/subagent-session.ts` (`promptForAnswer`, `actOnTurnBudget`, failure collection)
- Modify: `packages/pi-subagents/VENDORED.md` (subagent-session.ts row description)
- Test: `packages/pi-subagents/test/lifecycle/structured-result-loop.test.ts`, `test/lifecycle/subagent-session.test.ts`

- [ ] **Step 1:** Real-SDK loopback tests (RED): `maxTurns: 2`, script `[[READ],[READ],[READ],"late"]`, schema launch → `status` `aborted`, `turnBudget.phase` `exhausted`, `structuredResultError` `"missing"`; same with no schema → `aborted`; a scripted provider error on turn 1 (HTTP 500 / error finish) → `error`.
- [ ] **Step 2:** Fix (revised after review: error-suppression heuristics cannot tell an abort-caused error from an independent provider failure): stop the turn budget at the completed-turn boundary. The `finishTurn` wrapper shared with the structured-result end takes the budget decision and returns `end` (plus the unawaited `session.abort()`), so no request is aborted; error reporting is unchanged. A turn forced past the ceiling keeps the `turn_start` abort. Unit tests in `subagent-session.test.ts` drive the hook before `turn_end`; the loopback tests assert the request count equals `maxTurns`.
- [ ] **Step 3:** Run `bun run --cwd packages/pi-subagents check && bun run --cwd packages/pi-subagents test`; root `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 4:** Commit `fix(pi-subagents): settle a turn-limit stop as aborted`.

---

## Task 6: Rebase integration with service-launch-wait — implements 6

**Covers:** 6.1, 6.2
**Difficulty:** Easy
**Blocked by:** Task 5

Added after the rebase onto main (#94 launch-resources, #95 service-launch-wait), user-approved rebase.

**Files:**
- Modify: `packages/pi-subagents/src/service/service-adapter.ts` (`toWaitedRecord`)
- Test: the existing wait tests under `packages/pi-subagents/test/` (service-wait)

- [ ] **Step 1:** RED: wait test — run ends with a question, observer resumes before the waiter reads, resumed run submits → waited snapshot has the question and neither structured field; and a waited run that submits → `structuredResult` present.
- [ ] **Step 2:** In `toWaitedRecord`, `setOrOmit` both fields from `run` (`RunOutcome` already exposes them).
- [ ] **Step 3:** Package `check`/`test`, root `typecheck`/`lint`/`bun test` → PASS. Commit `fix(pi-subagents): carry the waited run's structured outcome`.

---

## Scenario → test

structured-result:
- Schema accepted → `result-schema.test.ts` "accepts the issue example"; `service-adapter.test.ts` "valid schema reaches the manager"
- Caller mutates the schema after spawn → `structured-result-flow.test.ts` third launch; `result-schema.test.ts` "mutating input after parse"
- No schema → `create-subagent-session.test.ts` "no schema, tool list unchanged"; `service-adapter.test.ts` snapshot "fields absent"; `subagent-events-observer.test.ts` "no schema, no keys"
- Draft URI accepted → `result-schema.test.ts` "accepts 2020-12 URI with annotations"
- Other draft refused → `result-schema.test.ts` "refuses draft-07 $schema"
- Unsupported keyword → `service-adapter.test.ts` "unsupported keyword throws, listAgents unchanged"
- Missing root type → `result-schema.test.ts` "no root type"
- Fork with a schema → `service-adapter.test.ts` "caller fork + schema"
- Agent default fork with a schema → `service-adapter.test.ts` "agent file fork + schema"
- Refusal before the policy → `service-adapter.test.ts` "policy not called on refusal"
- Tool installed → `create-subagent-session.test.ts` "schema installs submit_result beside ask_parent and notify_parent"
- Counted as the child's own tool → `create-subagent-session.test.ts` "toolCount 3"
- Disallowed tools cannot remove it → `create-subagent-session.test.ts` "disallowedTools cannot remove submit_result"
- Policy cannot remove it → `launch-policy.test.ts` "removeTools cannot remove submit_result"
- Invalid value reported to the child → `submit-result-tool.test.ts` "invalid value"; `structured-result-flow.test.ts`
- Child fixes the value → `structured-result-flow.test.ts` "invalid then valid"
- Coerced argument stored → `submit-result-tool.test.ts` "coercion contract"
- Extra property refused → `result-schema.test.ts` "additionalProperties false"
- Integer checked → `result-schema.test.ts` "integer rejects 1.5"
- Whole float accepted → `result-schema.test.ts` "integer accepts 3"
- Second submission ignored → `subagent-run.test.ts` "already-submitted"; `submit-result-tool.test.ts` "already submitted text"
- Submit alone → `structured-result-loop.test.ts` "submit alone, one request"; `subagent.test.ts` "completed with structured result"
- Submit beside other tools → `structured-result-loop.test.ts` "read + submit, one request"
- Submit on the last permitted turn → `subagent.test.ts` "exhausted + stored value → completed" (submit-alone and mixed batch)
- External stop after submit → `subagent.test.ts` "abort after stored value keeps stopped and result"
- Turn limit reached → `structured-result-loop.test.ts` "turn limit reached without submission settles aborted" (real SDK); `subagent-run.test.ts` "markAborted with no value sets error"
- Pending question → `subagent-run.test.ts` "pending question, both undefined"
- Resume submits → `subagent.test.ts` "resume stores on the resume run"
- Resume clears the previous outcome → `subagent.test.ts` "resumed run starts clear"
- Valid submission has no error → `subagent-run.test.ts` "value after attempt, no error"
- Invalid attempt then question → `subagent-run.test.ts` "pending question after invalid attempt"; `subagent.test.ts` "old run stays clear after resume"
- Never called → `subagent-run.test.ts` "missing"; `structured-result-flow.test.ts` second launch
- Only invalid calls → `subagent-run.test.ts` "invalid"; `subagent-session.test.ts` "onSubmitAttempt per call"
- Completed event → `structured-result-flow.test.ts` "subagents:completed carries structuredResult"
- Missing on the event → `structured-result-flow.test.ts` second launch
- Structured outcome on a waited snapshot / Resumed before the waiter reads it → service wait test (Task 6)
- Structured outcome on a waited snapshot / Waited run submitted → service wait test (Task 6)
- Not persisted → `persisted-record.test.ts` "no structured fields persisted"

executor-launch-policy:
- Tool-call origin → `launch-policy.test.ts` "tool-call origin, agent type and requested model" (existing)
- Orchestration tools never offered → `launch-policy.test.ts` "orchestration tools are never offered" (existing)
- Protocol tools never offered → `launch-policy.test.ts` "ask_parent and submit_result excluded" (new)
- Excluded extension's tool not offered → `launch-policy.test.ts` "an excluded extension's tool is not offered" (existing)
- Locked caller value not requested → `launch-policy.test.ts` "a locked caller value is not requested" (existing)
- Fork request → `launch-policy.test.ts` "Fork request: no caller model …" (existing)
- Locked fork request → `launch-policy.test.ts` "Locked fork request: …" (existing)
- Fallen-back fork → `subagent-manager.test.ts` "Fallen-back fork: the launch policy receives context fresh" (existing)
- Service launch with metadata → `launch-metadata-flow.test.ts` "Service launch with metadata" (existing)
- No metadata in the request → `launch-metadata-flow.test.ts` "No metadata in the request" (existing)
