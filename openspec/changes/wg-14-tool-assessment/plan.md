# Tool Assessment Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Score the tools of workers whose agent declares no `tools`, record would-remove counts on the `worker` ledger line in `observe`, remove flagged tools in `enforce`, and keep every tool on any failure.

**Architecture:** Pure rules in `src/policy/tools.ts`; request state and questions in `src/jev/`; in `src/host/`, `tool-service.ts` captures the main session's executor service, `tool-counts.ts` holds the process-wide counts map keyed by agent id, `tool-facts.ts` maps Pi's `ToolInfo`, and `tools.ts` finds the worker's record by session file, asks Jev once per worker session and edits `selectedTools`. `worker.ts` reads the counts when it writes the line.

**Tech Stack:** TypeScript run by Pi 1.5.0, Bun tests, `@gotgenes/pi-subagents` 25.0.5 (read through `globalThis`, never imported in `src/`).

**Spec:** `openspec/changes/wg-14-tool-assessment/specs/` and `design.md`.

## Global Constraints

- Public Pi APIs only; only `src/host/` touches Pi or executor state; `src/policy/` imports nothing outside itself and `src/shared/`; `src/jev/` knows nothing about Pi.
- Fail open: any error leaves `selectedTools` exactly as it was and writes no counts.
- Threshold `0.5` (inclusive); cap `32` candidates; brief cut to its last `4000` code points; tool and parameter descriptions cut to `500` code points.
- Never candidates: `ask_parent`, `notify_parent`.
- Executor service key: `Symbol.for("@gotgenes/pi-subagents:service")`. Package keys: `Symbol.for("pi-jev-pilot.mainService")`, `Symbol.for("pi-jev-pilot.toolCounts")`.
- No prompt text, tool names or tool arguments in the ledger or the counts map.
- No new dependency; no change to `config.json`, `state.json` or the ledger schema.
- Tests need no secrets, paid calls or network beyond loopback.
- Before starting: `codegraph init` if `.codegraph/` is missing; read `~/.agents/skills/coding-standards/SKILL.md`.

## Review Focus

- A worker whose session file is undefined (in-memory session): lookup must miss cleanly, not match a record whose `outputFile` is also undefined. Test in Task 5.
- A `selectedTools` that is missing or not an array: no request, no throw. Test in Task 5.
- `pi.getAllTools()` throws or lacks a candidate: that candidate is sent with an empty description and no parameters, not dropped silently from scoring. Test in Task 5.
- A child's `session_shutdown` clearing the captured service: every later worker would miss silently. Test in Task 6.
- A `ToolInfo` whose `parameters` has no `properties`, a property without `description`, or a throwing getter: mapped to `{}` / skipped, never thrown. Test in Task 4.
- Two workers with identical briefs at once: each finds its own record by session file and its counts land on its own line. Covered by the concurrency host test in Task 8.
- The counts map holds an entry for a launch that never gets a line: bounded at 256, oldest evicted; no growth. Test in Task 4.

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `toolCandidates` | new | `(selected: readonly string[]) => { scored: string[]; kept: string[] }` in `src/policy/tools.ts`; `scored` is the first 32 after removing `ask_parent`/`notify_parent`, `kept` the rest | no |
| `flaggedTools` | new | `(answers: Record<string, Answer>, scored: readonly string[]) => Set<string>`; name flagged when `answers["tool::"+name]` is a noul `>= 0.5` | no |
| `TOOL_THRESHOLD`, `TOOL_CAP`, `NEVER_CANDIDATES` | new | `0.5`, `32`, `["ask_parent", "notify_parent"] as const` | no |
| `ToolCounts`, `toolCounts` | new | `{ toolsScored: number; toolsFlagged: number }`; `toolCounts(scored: readonly string[], flagged: ReadonlySet<string>) => ToolCounts` | no |
| `cutLastCodePoints` | new | `(text: string, max: number) => string` in `src/shared/text.ts`; the last `max` code points | no |
| `toolFacts` | new | `(info: unknown) => { name: string; description: string; source: string; parameters: Record<string, string> } \| undefined` in `src/host/tool-facts.ts`; `source` is `sourceInfo.source` when a non-empty string, else `"unknown"`; `parameters` maps each key of `parameters.properties` whose value has a string `description` to it; anything else, or a throw, yields `{}` / empty strings | no |
| `buildToolQuestions` | new | `(names: readonly string[]) => { questions: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> }`; keys `tool::<name>`, all noul | no |
| `TOOL_QUESTION` | new | `(name: string) => WireQuestion` in `src/jev/rubrics.ts`; noul; instructions and `true`/`false` criteria copied verbatim from `docs/jev-questions.md#tool-assessment` with `<name>` substituted | no |
| `ToolStateInput`, `ToolState`, `buildToolState` | new | input `{ brief: string; description: string; agent: AgentFacts; tools: { name: string; description: string; source: string; parameters: Record<string, string> }[] }`; output `{ task: { brief; description }; agent: { name; source; description }; tools: Record<string, { description; source; parameters: Record<string, string> }> }` | no |
| `captureMainService`, `clearMainService`, `mainService` | new | `(): void`, `(): void`, `(): ServiceLike \| undefined` in `src/host/tool-service.ts`; `ServiceLike = { listAgents(): unknown[] }` | no |
| `putToolCounts`, `takeToolCounts` | new | `(agentId: string, c: ToolCounts) => void`, `(agentId: string) => ToolCounts \| undefined` in `src/host/tool-counts.ts`; map bounded at 256 | no |
| `createToolAssessment` | new | `(pi: Pick<ExtensionAPI, "getAllTools">, deps?: { ask?: typeof askJev; snapshot?: () => Snapshot; agentDir?: string; service?: () => ServiceLike \| undefined }) => { beforeAgentStart(event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<void>; dispose(sessionId: string): void }` (`dispose` added in Task 6: drops the per-session outcome on `subagents:child:disposed`, so the map stays bounded; internal) | no |
| `worker` ledger line | modified | gains optional `toolsScored`, `toolsFlagged` (already in `LEDGER_FIELDS`) | yes (file content, format unchanged) |

---

## Task 1: Pure tool rules — implements 1.1

**Files:** Create `src/policy/tools.ts`; Test `tests/policy/tools.test.ts`

**Interfaces:** Produces `toolCandidates`, `flaggedTools`, `toolCounts`, `TOOL_THRESHOLD`, `TOOL_CAP`, `NEVER_CANDIDATES`, `ToolCounts` (Contracts). Consumes `Answer` from `src/policy/answers.ts`.

- [ ] **Step 1: Write failing tests**
  - `Protocol tools never candidates`: `toolCandidates(["read","bash","ask_parent","notify_parent"]).scored` equals `["read","bash"]`.
  - `Cap at 32`: 40 names `t0..t39` → `scored` is `t0..t31`, `kept` is `t32..t39`.
  - `Threshold boundary`: answers `tool::edit` noul 0.5, `tool::bash` noul 0.49 → `flaggedTools` is `{"edit"}`.
  - `One bad answer`: only `tool::bash` 0.9 present (edit unanswered) → `{"bash"}`.
  - `Never adds`: `tool::ghost` 0.9 with `scored` `["read"]` → empty set.
  - `toolCounts`: 5 scored, flagged `{"a","b"}` → `{ toolsScored: 5, toolsFlagged: 2 }`.
- [ ] **Step 2:** `bun test tests/policy/tools.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement the exports in `src/policy/tools.ts`; no import outside `src/policy/` and `src/shared/`.
- [ ] **Step 4:** `bun test tests/policy/tools.test.ts` → PASS; `bun run lint` → clean.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): pure candidate and flag rules"`

## Task 2: Tool questions — implements 2.1

**Files:** Modify `src/jev/rubrics.ts`, `src/jev/questions.ts`; Test `tests/jev/questions.test.ts`

**Interfaces:** Produces `TOOL_QUESTION`, `buildToolQuestions`.

- [ ] **Step 1: Failing test** `One noul per candidate`: `buildToolQuestions(["read","edit","bash"])` has exactly keys `tool::read`, `tool::edit`, `tool::bash`; each `questions[k].type === "noul"`, `specs[k]` is `{ type: "noul" }`; `questions["tool::edit"].instructions` contains `` `tools.edit` `` and its `criteria.true`/`criteria.false` equal the two lines in `docs/jev-questions.md#tool-assessment`; mutating one result does not change the next call's.
- [ ] **Step 2:** `bun test tests/jev/questions.test.ts` → FAIL.
- [ ] **Step 3:** Add `TOOL_QUESTION(name)` with the wording from `docs/jev-questions.md#tool-assessment`, and `buildToolQuestions` in `src/jev/questions.ts`.
- [ ] **Step 4:** `bun test tests/jev/questions.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): tool questions"`

## Task 3: Tool state — implements 2.2

**Files:** Modify `src/jev/state.ts`, `src/shared/text.ts`; Test `tests/jev/state.test.ts`, `tests/shared/text.test.ts`

**Interfaces:** Produces `ToolStateInput`, `ToolState`, `buildToolState`, `cutLastCodePoints`. Consumes `cutCodePoints` and `AgentFacts`.

- [ ] **Step 1: Failing tests**
  - `Long brief`: brief of 5000 code points (`"a".repeat(1000) + "b".repeat(4000)`) → `task.brief === "b".repeat(4000)`.
  - `Forked worker`: brief `"PARENT-CONTEXT…" + "CHILD-TASK"` (under 4000) → `task.brief` ends with `"CHILD-TASK"`.
  - `Tool metadata`: tool `bash` with description `D` and parameters `{ command: "Shell command to execute" }` → `tools.bash` equals `{ description: "D", source: "builtin", parameters: { command: "Shell command to execute" } }`.
  - `Long tool description`: 900-code-point description → first 500 code points; same for a parameter description.
  - `agent` is exactly `{ name, source, description }` (no model, thinking or excerpt).
  - `cutLastCodePoints("a😀b", 2) === "😀b"`; shorter text unchanged.
- [ ] **Step 2:** `bun test tests/jev/state.test.ts` → FAIL.
- [ ] **Step 3:** Add `cutLastCodePoints` to `src/shared/text.ts`; implement `buildToolState` with it for the brief and `cutCodePoints` for descriptions.
- [ ] **Step 4:** `bun test tests/jev tests/shared` → PASS.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): tool assessment state"`

## Task 4: Service capture, counts map and tool facts — implements 3.1

**Files:** Create `src/host/tool-service.ts`, `src/host/tool-counts.ts`, `src/host/tool-facts.ts`; Test `tests/host/tool-service.test.ts`, `tests/host/tool-counts.test.ts`, `tests/host/tool-facts.test.ts`

**Interfaces:** Produces `captureMainService`, `clearMainService`, `mainService`, `putToolCounts`, `takeToolCounts`, `toolFacts` (Contracts). Three files, one responsibility each, so `worker.ts` imports only `tool-counts.ts`.

- [ ] **Step 1: Failing tests**
  - Service: `captureMainService` copies the object at the executor key; a second capture replaces it; `clearMainService` empties it; with no global, `mainService()` is undefined.
  - Counts: put/take round trip; take deletes; `Counts map bounded` (257 puts → first evicted); only integers stored (no other keys survive).
  - Facts: a TypeBox `Type.Object({ command: Type.String({ description: "Shell command to execute" }), x: Type.Number() })` → `parameters` `{ command: "Shell command to execute" }`; no `properties` → `{}`; `sourceInfo.source` `"builtin"` → `"builtin"`; missing `sourceInfo` → `"unknown"`; an object whose `parameters` getter throws → `parameters` `{}`; non-object → undefined.
- [ ] **Step 2:** `bun test tests/host/tool-service.test.ts tests/host/tool-counts.test.ts tests/host/tool-facts.test.ts` → FAIL.
- [ ] **Step 3:** Implement the three modules.
- [ ] **Step 4:** Same command → PASS; `bun run lint` → clean.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): service capture, counts map, tool facts"`

## Task 5: Assessment handler — implements 3.2

**Files:** Create `src/host/tools.ts`; Test `tests/host/tools.test.ts`

**Interfaces:** Consumes Tasks 1–4, `isChild` (`src/host/child.ts`), `readAgent` (`src/host/agents.ts`), `loadSnapshot`/`Snapshot`, `askJev`/`JevOutcome`, `readWorkerOutcome`. Produces `createToolAssessment` (Contracts).

Behaviour (design D1–D7): per-instance `Map<sessionId, { kind: "none" } | { kind: "done"; mode; flagged: Set<string> }>`. First call: gate (child, config valid, key set, `tools` switch, `deps.service()` defined, `messageType === "user"`, non-empty prompt, `selectedTools` array, `getSessionFile()` a string); exactly one record with `outputFile === file`; `readAgent(record.type, …)`; `declaredTools === null`; candidates non-empty; build tool metadata with `toolFacts` over `pi.getAllTools()` (missing tool → empty description, `"unknown"` source, `{}` parameters; `getAllTools` throwing → same for all); `await ask(...)` with `classifier.timeoutMs` and no signal; `readWorkerOutcome`; on `read` compute flags, store `done`, `putToolCounts(record.id, …)`; otherwise store `none`. Every call: if `done` and mode `enforce`, splice flagged names out of `selectedTools`. Whole body in try/catch.

- [ ] **Step 1: Failing tests** (fake `pi`, fake service, fake `ask`, child registry seeded through `CHILDREN_KEY`), one per scenario, named after it:
  - When assessment runs: `Switch off`, `No key`, `Invalid config`, `Main session`, `Executor absent` (no capture, nothing in the child registry) → `ask` not called and tools unchanged.
  - `Mode read once`: first call with `observe` flags `edit`; the snapshot then returns `enforce`; the second call does not splice `edit`.
  - Worker finds its launch: `Record found` (state `agent.name` `general-purpose`, `task.description` `probe`), `No record`, `Lookup throws`, `Several records match`, plus Review Focus `Undefined session file`.
  - Captured executor service: `Child's own service ignored` (global holds an empty service, capture holds the real one → found), `New main session` (second capture wins), `Main session shut down` (cleared → no request).
  - Only agents that declare no tools: `Declared tools` (`Explore`), `Agent file without tools`, `Empty tools list` (agent files in a temp `agentDir`).
  - Candidates: `Protocol tools never candidates`, `Review tool never a candidate` (`jev_review` already absent from `selectedTools` after `hideReviewInChild`), `Cap at 32` (8 kept in `enforce` even if answered 0.9).
  - Brief: `Empty prompt`, plus non-`user` `messageType` → no request.
  - Waits: `Slow answer in observe` / `Slow answer in enforce` → `beforeAgentStart` resolves only after `ask` resolves; tools as expected.
  - Observe and enforce: `Observe keeps tools`, `Enforce removes`, `Never adds`.
  - Once per worker: `Resumed worker` (second call, `ask` called once, `edit` spliced again), `Failed first call not retried`.
  - Fail open: `Jev down in enforce` (miss `error`), `Timeout` (miss `timeout`), `Malformed response` (`{}` body) → tools unchanged, `takeToolCounts` undefined.
  - Counts: `Counts on the line` (5 scored, 2 flagged → `takeToolCounts("ag-1")` is `{ toolsScored: 5, toolsFlagged: 2 }`), `No worker line` (counts put and left; `enforce` still splices).
  - Review Focus: `selectedTools not an array`, `getAllTools throws` (candidate still scored with empty description).
- [ ] **Step 2:** `bun test tests/host/tools.test.ts` → FAIL.
- [ ] **Step 3:** Implement `src/host/tools.ts`, split into record lookup, request building, decision and the composing handler; no function holding all of them.
- [ ] **Step 4:** `bun test tests/host/tools.test.ts` → PASS; `bun run typecheck && bun run lint` → clean.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): child-side assessment handler"`

## Task 6: Wiring — implements 3.3

**Files:** Modify `src/host/setup.ts`; Test `tests/host/setup.test.ts`

**Interfaces:** Consumes `createToolAssessment`, `captureMainService`, `clearMainService`.

- [ ] **Step 1: Failing tests** in `tests/host/setup.test.ts`: main `session_start` calls the capture (global service object is then returned by `mainService()`); child `session_start` does not; `session_shutdown` of the main instance clears it; a child's `session_shutdown` leaves it; after main `session_start`, child `session_start` and child `session_shutdown`, `mainService()` is still the main one; child `before_agent_start` runs `hideReviewInChild` then the assessment (with a fake service, `jev_review` is never a scored candidate); a throwing assessment leaves `before_agent_start` returning `undefined`.
- [ ] **Step 2:** `bun test tests/host/setup.test.ts` → FAIL.
- [ ] **Step 3:** Wire as in design D1/D4: capture inside the existing main `session_start` try block before `main.sessionStart()`; `session_shutdown` gains its `(event, ctx)` parameters and clears only when `isChild(ctx.sessionManager.getSessionId())` is false (the child's id leaves the registry only on `disposed`, after its shutdown); in the child branch `await tools.beforeAgentStart(event, ctx)` after `hideReviewInChild`.
- [ ] **Step 4:** `bun test tests/host/setup.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): wire into setup"`

## Task 7: Counts on the worker line — implements 3.4

**Files:** Modify `src/host/worker.ts` (`write()` and the `tool_result` path that knows `agentId`); Test `tests/host/worker-ledger.test.ts`

**Interfaces:** Consumes `takeToolCounts` (`src/host/tool-counts.ts`). Set `entry.agentId` (new `LaunchEntry` field `agentId?: string`) at the top of the `tool_result` handler from `details.agentId`, before any branch, so the buffered path (outcome first) and the `byAgent` path (result first) both see it. A resume is `entry.launch.resume`.

- [ ] **Step 1: Failing tests** (named after the worker-ledger scenarios): `Tool counts recorded` (`putToolCounts("ag-t1", {4,1})` before completion → line has `toolsScored` 4, `toolsFlagged` 1 and passes `validateLedgerEntry`); `No assessment, no counts` (no entry → no fields); `Resumed launch carries no counts` (resume input with an entry for that agent → no fields, and the counts entry stays in the map); counts recorded in both orderings (outcome before result, result before outcome); `Refused launch` with no agent id → no counts read.
- [ ] **Step 2:** `bun test tests/host/worker-ledger.test.ts` → FAIL.
- [ ] **Step 3:** In `write()`, when `entry.agentId` is set and `entry.launch.resume` is false, `takeToolCounts` and set both fields.
- [ ] **Step 4:** `bun test tests/host/worker-ledger.test.ts tests/store/ledger-schema.test.ts` → PASS.
- [ ] **Step 5:** `git commit -m "feat(tool-assessment): counts on the worker line"`

## Task 8: Host tests with the real executor — implements 4.1, 4.2

A verification task: the units exist, so these tests are written to pass, not red first.

**Files:** Create `tests/host/tool-assessment.test.ts`

**Interfaces:** Uses `startHostSession` (`self: true`, `executor: true`), `startFixture`, `startJevFixture`, `readLedger`, the `writeJev`/`config` pattern from `tests/host/worker-routing.test.ts`. One Jev route serves main, worker and tool requests: its `answers` hold the main and worker answers (reuse `choice()` from `worker-routing.test.ts`, so `effort` fits both option sets) and the `tool::*` nouls; `readAnswers` reads only the keys it asked. Tell tool requests apart by `tool::` keys in the recorded body.

Agents: `probe-open` (agent file with no `tools`), plus built-in `Explore`. The main script launches `subagent` with `subagent_type: "probe-open"`, a brief containing `CHILD-TASK` and the marker; the child script calls `edit` once when testing removal.

- [ ] **Step 1: Write the tests** (timeout 90 s each):
  - `observe keeps tools and records counts`: `tool::edit` 0.9, others 0.1 → the child's first provider request offers `edit`; the `worker` line has `toolsScored` equal to the number of scored tools and `toolsFlagged` 1; a `tool::*` question for `ask_parent` is absent from the recorded Jev request.
  - `enforce removes a flagged tool`: `state.json`/`config.json` with `tools.mode` `enforce` → no child request offers `edit`; the child's `edit` call gets an error result containing `not found`.
  - `Jev refused in enforce keeps every tool`: Jev route `{ status: 500 }` → the child's first request offers the same tool names as a run with the `tools` switch off.
  - `Explore sends no tool request`: launch `Explore` → no recorded Jev request has a `tool::` question.
  - `no prompt marker in the ledger`: no ledger file contains the marker.
  - `record found at first before_agent_start` and `concurrent workers name their own agent`: two background launches (`probe-open`, `probe-open-2` with different descriptions) → two Jev tool requests, each `agent.name` its own, each line its own counts.
- [ ] **Step 2:** `bun test tests/host/tool-assessment.test.ts` → PASS against Tasks 1–7. A failure of the record-timing test is a design stop: report it and ask the operator before any fallback.
- [ ] **Step 3:** `git commit -m "test(tool-assessment): host tests with the real executor"`

## Task 9: Docs and final checks — implements 5.1, 5.2, 5.3

**Files:** Modify `docs/jev-contract.md`, `docs/jev-questions.md`, `docs/domain-model.md`, `docs/workflow.md`, `docs/usage-guide.md`, `docs/architecture.md`, `docs/evidence/2026-11-05-host-seams.md`, `docs/roadmap.md`.

- [ ] **Step 1:** Update each doc as listed in the proposal: request state with the 500/4000 cuts and candidates; wording marked provisional; `ToolAssessment` once per worker, counts only on an existing line, resumes carry none; workflow section 3 with record lookup and waiting in both modes; usage guide (counts in the ledger, bounded wait in `observe`); architecture host seams rows ("Find a worker's launch: executor service `listAgents()` by `outputFile`, captured at main `session_start`" — Verified by Task 8), layout (`host/tools.ts`, `host/tool-service.ts`, `host/tool-counts.ts`, `host/tool-facts.ts`, `policy/tools.ts`), performance budget row; evidence section with versions and what Task 8 observed; roadmap WG-14 `Done`.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun run fmt:check && bun test` → all pass.
- [ ] **Step 3:** `git commit -m "docs(tool-assessment): contract, workflow, evidence and roadmap"`

---

## Scenario → test

tool-assessment:
- Switch off → `tests/host/tools.test.ts` "Switch off"
- No key → `tests/host/tools.test.ts` "No key"
- Invalid config → `tests/host/tools.test.ts` "Invalid config"
- Main session → `tests/host/tools.test.ts` "Main session"
- Executor absent → `tests/host/tools.test.ts` "Executor absent" (no capture, not a child)
- Mode read once → `tests/host/tools.test.ts` "Mode read once"
- Record found → `tests/host/tools.test.ts` "Record found"
- Concurrent workers → `tests/host/tool-assessment.test.ts` "concurrent workers name their own agent"
- No record → `tests/host/tools.test.ts` "No record"
- Lookup throws → `tests/host/tools.test.ts` "Lookup throws"
- Several records match → `tests/host/tools.test.ts` "Several records match"
- Child's own service ignored → `tests/host/tools.test.ts` "Child's own service ignored"
- New main session → `tests/host/tool-service.test.ts` second capture; `tests/host/tools.test.ts` "New main session"
- Main session shut down → `tests/host/tools.test.ts` "Main session shut down"; `tests/host/setup.test.ts` main clears, child does not
- Declared tools → `tests/host/tools.test.ts` "Declared tools"; `tests/host/tool-assessment.test.ts` "Explore sends no tool request"
- Agent file without tools → `tests/host/tools.test.ts` "Agent file without tools"
- Empty tools list → `tests/host/tools.test.ts` "Empty tools list"
- Protocol tools never candidates → `tests/policy/tools.test.ts`; `tests/host/tool-assessment.test.ts` "observe keeps tools and records counts"
- Review tool never a candidate → `tests/host/tools.test.ts`; `tests/host/setup.test.ts`
- Cap at 32 → `tests/policy/tools.test.ts`; `tests/host/tools.test.ts` "Cap at 32"
- One noul per candidate → `tests/jev/questions.test.ts`
- Tool metadata from Pi → `tests/host/tool-facts.test.ts` (TypeBox schema) and `tests/jev/state.test.ts` "Tool metadata"
- Long tool description → `tests/jev/state.test.ts` "Long tool description"
- Long brief → `tests/jev/state.test.ts` "Long brief"
- Forked worker → `tests/jev/state.test.ts` "Forked worker"
- Empty prompt → `tests/host/tools.test.ts` "Empty prompt"
- Brief not stored → `tests/host/tool-assessment.test.ts` "no prompt marker in the ledger"
- Slow answer in observe → `tests/host/tools.test.ts` "Slow answer in observe"
- Slow answer in enforce → `tests/host/tools.test.ts` "Slow answer in enforce"
- Threshold boundary → `tests/policy/tools.test.ts`
- One bad answer → `tests/policy/tools.test.ts`
- Observe keeps tools → `tests/host/tools.test.ts`; `tests/host/tool-assessment.test.ts` "observe keeps tools and records counts"
- Enforce removes → `tests/host/tools.test.ts`; `tests/host/tool-assessment.test.ts` "enforce removes a flagged tool"
- Never adds → `tests/policy/tools.test.ts`; `tests/host/tools.test.ts`
- Resumed worker → `tests/host/tools.test.ts` "Resumed worker"
- Failed first call not retried → `tests/host/tools.test.ts` "Failed first call not retried"
- Jev down in enforce → `tests/host/tools.test.ts`; `tests/host/tool-assessment.test.ts` "Jev refused in enforce keeps every tool"
- Timeout → `tests/host/tools.test.ts` "Timeout"
- Malformed response → `tests/host/tools.test.ts` "Malformed response"
- Counts on the line → `tests/host/tools.test.ts` "Counts on the line"; `tests/host/tool-assessment.test.ts` "observe keeps tools and records counts"
- No worker line → `tests/host/tools.test.ts` "No worker line" (counts put, never taken; enforce still splices)

worker-ledger (Decision fields):
- Routed fields, Fallback recorded, Nothing could run recorded, Thinking-only recorded, Miss recorded, Untouched recorded, Locked recorded, Not locked, No prompt text → existing tests in `tests/host/worker-ledger.test.ts` and `tests/host/worker-routing.test.ts` (unchanged)
- Tool counts recorded → `tests/host/worker-ledger.test.ts` "Tool counts recorded"
- No assessment, no counts → `tests/host/worker-ledger.test.ts` "No assessment, no counts"
- Resumed launch carries no counts → `tests/host/worker-ledger.test.ts` "Resumed launch carries no counts"
