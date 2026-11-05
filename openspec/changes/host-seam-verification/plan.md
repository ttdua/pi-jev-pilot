# Host Seam Verification Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Answer WG-02's eight host-seam questions from real runs, pin answers 1 to 7 as host tests, and bring `docs/` into agreement with the evidence.

**Architecture:** A test-only harness under `tests/host/` spawns the pinned `pi` CLI in RPC mode inside a temporary `PI_CODING_AGENT_DIR`, with `@gotgenes/pi-subagents` and one probe extension installed by `pi install`. A Bun HTTP server on `127.0.0.1` serves as an OpenAI-compatible provider that records every request and answers from a matcher-driven script. Probes report through a JSONL side file. Question 8 is a manual script against the real `claude-code` provider.

**Tech Stack:** TypeScript, Bun (`bun test`, `Bun.serve`, `Bun.spawn`), Pi `1.5.0` CLI in RPC mode, `@gotgenes/pi-subagents` `25.0.5`, `pi-claude-code` at `47f9e2b` (Q8 only).

## Global Constraints

- Tests need no secrets, paid calls or network beyond loopback; `PI_OFFLINE=1` for every harness CLI call.
- `@gotgenes/pi-subagents` devDependency is exactly `"25.0.5"`; `package.json` keeps no runtime `dependencies`.
- `src/` is not modified; `src/extension.ts` stays a no-op.
- Nothing writes to the operator's real agent dir; every temporary dir is removed after its test.
- Probe records, recorded request bodies and the Q8 output contain no prompt text, response text, tool arguments, tool output or account details. Request bodies stay in memory. Markers are synthetic strings such as `JEV-MARKER-7f3a`.
- Repository content is English. Existing checks (`typecheck`, `lint`, `fmt:check`, `test`) pass after every task.
- A host test that observes a "no" answer asserts that "no"; an observation is never a reason to skip or weaken a test. A test never asserts a value no run produced.
- Every pinned assertion's message contains `WG-02 Q<n>`, so a failure names its question.
- Every task ends with `bun run typecheck && bun run lint && bun run fmt:check && bun run test` exiting 0.
- The evidence report path is fixed now: `docs/evidence/2026-11-05-host-seams.md`. Its date is updated in Task 9 if the work ends on another day.

## Observe-then-pin procedure (Tasks 4 to 7)

1. Write each test with its assertions against a named constant, e.g. `const EXPECTED = { childModel: "fixture-fast", childEffort: "high" } as const;`, initially set to the values the spec scenario's positive reading predicts.
2. Run the test. If it fails, read the actual values from the failure output, and confirm them across 3 runs.
3. Set `EXPECTED` to the observed values, add `// WG-02 Q<n>: observed <date>, see docs/evidence/2026-11-05-host-seams.md#q<n>`, and rerun 3 times to PASS.
4. Append one line per question to the scratch file `tests/host/.observations.md` (gitignored): question, observed values, test name. Task 9 writes the report from it and deletes it.

## Review Focus

1. **Concurrent main and child requests** — a child's request can arrive while the main session awaits the tool result; the matcher must route by model id or marker, never by global order (Task 2 test `routes concurrent requests by matcher`).
2. **Process leaks** — a failing test must still kill the `pi` process and stop the server (Task 3 test `cleans up after a failed run`).
3. **Hung runs** — a run that never settles must fail with a timeout naming the last event, not hang CI (Task 3 test `times out with last event`).
4. **Unmatched request hidden as a pass** — every host test asserts `fixture.unmatched` is empty (Task 4 onward, in each test's teardown assertion).
5. **Offline executor install** — `pi install` of the `node_modules` copy may try to resolve the executor's own dependencies over the network; Task 3 test `installs executor offline` covers it. If the primary install fails, the harness falls back to installing a `bun pm pack` tarball and records the path used in `HostSession.installPath` (`"node_modules"` or `"tarball"`); the same test asserts whichever path the harness uses, and the evidence report states it.

---

## Contracts

All contracts are test-internal; none is part of the package's public surface.

| Name | new / modified | Shape | public |
|---|---|---|---|
| `devDependencies["@gotgenes/pi-subagents"]` | new | `"25.0.5"` in `package.json` | no |
| `RecordedRequest` | new | `{ seq: number; model: string; reasoningEffort: string \| undefined; toolNames: string[]; body: Record<string, unknown>; matched: string \| null }` in `tests/host/fixture.ts` | no |
| `ScriptEntry` | new | `{ name: string; match: (req: RecordedRequest) => boolean; reply: FixtureReply; times?: number }`; `FixtureReply = { text: string } \| { toolCalls: { name: string; arguments: Record<string, unknown> }[] }` | no |
| `startFixture` | new | `startFixture(script: ScriptEntry[]): Promise<Fixture>`; `Fixture = { baseUrl: string; port: number; requests: RecordedRequest[]; unmatched: RecordedRequest[]; stop(): Promise<void> }` | no |
| Fixture `models.json` | new | `{ providers: { fixture: { baseUrl, api: "openai-completions", apiKey: "fixture", compat: { thinkingFormat: "openai", supportsReasoningEffort: true }, models: [{ id: "fixture-main", reasoning: true }, { id: "fixture-balanced", reasoning: true }, { id: "fixture-fast", reasoning: true }] } } }` | no |
| `RpcResponse` | new | `{ id?: string; type: "response"; command: string; success: boolean; data?: Record<string, unknown>; error?: string }` in `tests/host/rpc.ts` | no |
| `RpcEvent` | new | `{ type: string; [key: string]: unknown }` (any non-response stdout record) in `tests/host/rpc.ts` | no |
| `spawnRpc` | new | `spawnRpc(opts: { agentDir: string; cwd: string; args: string[]; env?: Record<string, string>; timeoutMs?: number }): RpcProcess`; `RpcProcess = { send(cmd: Record<string, unknown>): Promise<RpcResponse>; prompt(text: string): Promise<void>; waitFor(pred: () => boolean, label: string): Promise<void>; events: RpcEvent[]; close(): Promise<void> }` in `tests/host/rpc.ts` | no |
| `startHostSession` | new | `startHostSession(opts: { fixture: Fixture; probes?: string[]; executor?: boolean; agents?: Record<string, string>; persist?: boolean; model?: string; thinking?: string; env?: Record<string, string>; timeoutMs?: number }): Promise<HostSession>` in `tests/host/harness.ts` | no |
| `HostSession` | new | `RpcProcess & { agentDir: string; cwd: string; installPath: "node_modules" \| "tarball" \| null; probeRecords(): ProbeRecord[] }`. `agents` option keys are file stems (`probe-worker` writes `agents/probe-worker.md`), values are the full file text. `prompt` resolves at once when the response `data.disposition` is `"handled"`, otherwise on `agent_settled`; `send` resolves on the matching response; `waitFor` polls until `pred()` holds and rejects after `timeoutMs` (default 30 000) with `label` and the last event type | no |
| Probe package | new | `tests/host/probes/<name>/package.json` with `{ "name": "jev-probe-<name>", "private": true, "type": "module", "keywords": ["pi-package"], "pi": { "extensions": ["./index.ts"] } }` and `index.ts` | no |
| `probeReport` | new | `probeReport(probe: string): (event: string, fields?: { sessionId?: string; data?: Record<string, string \| number \| boolean> }) => void` in `tests/host/probes/report.ts`; appends synchronously with `appendFileSync`; `seq` comes from a counter on `globalThis[Symbol.for("jev-probe.seq")]`, monotonic within the one Pi process that hosts main and child sessions; `t` is `performance.now()` | no |
| `JEV_PROBE_REPORT` | new | environment variable: absolute path of the JSONL file probes append to | no |
| `ProbeRecord` | new | one JSON object per line: `{ probe: string; event: string; seq: number; t: number; sessionId?: string; data?: Record<string, string \| number \| boolean> }`; `data` values are identifiers, counts or flags only | no |
| Probe control env vars | new | `JEV_REWRITE_MODEL`, `JEV_REWRITE_THINKING` (`rewrite` probe); `JEV_REMOVE_TOOL` (`child` probe); `JEV_HIDDEN_FLAG` = path of a file whose existence turns the hidden message on, `JEV_SET_THINKING` (`main` probe) | no |
| Q8 script output | new | stdout lines `turn=<n> level=<level> events=<names> cacheRead=<n> cacheWrite=<n> input=<n>` then `date=<iso> pi=<v> executor=<v> pi-claude-code=47f9e2b model=claude-code/claude-haiku-5-5` | no |
| Evidence report | new | `docs/evidence/2026-11-05-host-seams.md`: summary table `Q \| Question \| Answer \| Evidence \| Level \| Versions`, then one section per question | no |

---

## Task 1: Pin the executor — implements 1.1, 1.2

**Files:**
- Modify: `package.json`, `bun.lock`
- Test: `tests/manifest.test.ts`

**Interfaces:**
- Produces: `node_modules/@gotgenes/pi-subagents` at `25.0.5`, used by Task 3.

- [ ] **Step 1: Write the failing test** in `tests/manifest.test.ts`: `test("executor is pinned exactly")` asserting `pkg.devDependencies["@gotgenes/pi-subagents"] === "25.0.5"` and that `pkg.dependencies` is absent or empty.
- [ ] **Step 2: Run** `bun test tests/manifest.test.ts`. Expected: FAIL on the missing devDependency.
- [ ] **Step 3: Add the dependency** with `bun add -d --exact @gotgenes/pi-subagents@25.0.5`.
- [ ] **Step 4: Verify** `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all exit 0.
- [ ] **Step 5: Commit** `package.json bun.lock tests/manifest.test.ts` as `Pin @gotgenes/pi-subagents 25.0.5 for host tests`.

---

## Task 2: Recording loopback provider — implements 2.1, 2.2, 2.3, 2.4

**Files:**
- Create: `tests/host/fixture.ts`
- Test: `tests/host/fixture.test.ts`

**Interfaces:**
- Produces: `startFixture`, `RecordedRequest`, `ScriptEntry`, `FixtureReply`, `Fixture`, and `fixtureModelsJson(baseUrl: string): object` returning the fixture `models.json` contract.

- [ ] **Step 1: Write failing tests** in `tests/host/fixture.test.ts`, each calling the server with `fetch`:
  - `binds loopback on an assigned port`: `baseUrl` starts with `http://127.0.0.1:` and `port > 0`.
  - `records request fields`: POST `{ model: "fixture-main", reasoning_effort: "high", tools: [{ type: "function", function: { name: "read" } }], messages: [], stream: true }`; `requests[0]` has `model === "fixture-main"`, `reasoningEffort === "high"`, `toolNames` equal to `["read"]`.
  - `streams a text reply`: the SSE body contains a `chat.completion.chunk` with the scripted text and ends with `data: [DONE]`.
  - `streams a tool-call reply`: the chunks carry `tool_calls[0].function.name === "subagent"` with JSON-string arguments and `finish_reason: "tool_calls"`.
  - `routes concurrent requests by matcher`: two concurrent POSTs for `fixture-main` and `fixture-fast` each get their own entry's reply.
  - `answers unmatched with an error`: status 500, and the request appears in `unmatched`.
  - `honours times`: an entry with `times: 1` matches once; the second identical request is unmatched.
- [ ] **Step 2: Run** `bun test tests/host/fixture.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement** `startFixture` with `Bun.serve({ hostname: "127.0.0.1", port: 0 })` serving `POST /v1/chat/completions`. Pick the first entry whose `match` returns true and whose `times` is not used up. Stream OpenAI chunks: role, then content or tool-call deltas, then `finish_reason` with a `usage` chunk, then `[DONE]`. Implement `fixtureModelsJson`.
- [ ] **Step 4: Run** `bun test tests/host/fixture.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `tests/host/fixture.ts tests/host/fixture.test.ts` as `Add recording loopback provider for host tests`.

---

## Task 3: Host session harness — implements 3.1, 3.2, 3.3, 3.4, 3.5

**Files:**
- Create: `tests/host/rpc.ts`, `tests/host/harness.ts`, `tests/host/probes/report.ts`, `tests/host/probes/noop/{package.json,index.ts}`
- Modify: `.gitignore` (add `tests/host/.observations.md`)
- Test: `tests/host/harness.test.ts`

**Interfaces:**
- Consumes: `startFixture`, `fixtureModelsJson` (Task 2); `PI_BIN`, `REPO_ROOT`, `tempDir` (`tests/helpers.ts`).
- Produces: `RpcResponse`, `RpcEvent`, `spawnRpc`, `RpcProcess`, `startHostSession`, `HostSession`, `ProbeRecord`, `probeReport`, and the probe package layout (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/host/harness.test.ts` (timeout 60 s each):
  - `prompt settles against the fixture`: script one text reply matched on `fixture-main`; with `thinking: "medium"`, after `prompt("hi")`, `fixture.requests.length === 1`, `requests[0].model === "fixture-main"`, `requests[0].reasoningEffort === "medium"`, and `fixture.unmatched` is empty. If Pi maps `medium` to another string, assert that string and note the mapping.
  - `agent dir is fresh and removed`: `agentDir` exists during the session, is not `~/.pi/agent`, and is gone after `close()`.
  - `installs executor offline`: with `executor: true`, the `pi install` exits 0 under `PI_OFFLINE=1` and the first recorded request's `toolNames` contains `subagent`.
  - `probe records are readable`: with `probes: ["noop"]`, which records `session_start`, `probeRecords()` contains `{ probe: "noop", event: "session_start" }`, and the report file contains no `JEV-MARKER-` string.
  - `subagent call launches a child`: the main reply is a `subagent` call (`subagent_type: "probe-worker"`, `model: "fixture/fixture-fast"`, `thinking: "high"`, `prompt: "go"`, `description: "probe"`); the child is matched on `fixture-fast` with text; after `prompt`, `waitFor` a `fixture-fast` request; it has `model === "fixture-fast"` and a defined `reasoningEffort`. Agent file `probe-worker.md` comes from `agents` with frontmatter `description: Probe worker` and `tools: read, grep`.
  - `times out with last event`: a script with no entries plus a short timeout rejects with a message naming the last event type.
  - `cleans up after a failed run`: after the rejection above, `close()` leaves no `pi` child process and no agent dir.
- [ ] **Step 2: Run** `bun test tests/host/harness.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3: Implement `spawnRpc`** in `tests/host/rpc.ts`:
  - Spawn `PI_BIN --mode rpc ...args` with the given env.
  - Read stdout as bytes split on LF only (not `readline`), and correlate responses by an incrementing `id`.
  - Implement `prompt` and `waitFor` per the `HostSession` contract.
  - `close()` ends stdin, then kills the process after 2 s.
- [ ] **Step 4: Implement `startHostSession`** in `tests/host/harness.ts`:
  - Create `agentDir` and `cwd` with `tempDir`, write `models.json` from `fixtureModelsJson`, and write `agents/<name>.md` for each entry in `agents`.
  - Run `pi install` with `PI_OFFLINE=1` for the executor (`node_modules/@gotgenes/pi-subagents`) and for each probe directory `tests/host/probes/<name>`. If the executor install exits non-zero, `bun pm pack` it into a temp dir and install the tarball instead.
  - Call `spawnRpc` with `--provider fixture --model <opts.model ?? "fixture-main">`, `--thinking <opts.thinking>` when set, and `--no-session` unless `persist`. Env is `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`, `JEV_PROBE_REPORT` and `opts.env`.
  - `close()` closes the process and removes both dirs.
- [ ] **Step 5: Run** `bun test tests/host/harness.test.ts`. Expected: PASS.
- [ ] **Step 6: Verify** `bun run typecheck && bun run lint && bun run fmt:check`, and that `tsconfig.json`'s `include` of `tests` covers `tests/host/**` and that probe imports of `@earendil-works/pi-coding-agent` types resolve. Expected: exit 0.
- [ ] **Step 7: Commit** `tests/host/ .gitignore` as `Add RPC host-session harness with probe reports`.

---

## Task 4: Worker model and thinking mutation (Q1, Q7) — implements 4.1, 4.7, 4.8

**Files:**
- Create: `tests/host/probes/rewrite/{package.json,index.ts}`
- Test: `tests/host/q1-q7-worker-mutation.test.ts`

**Interfaces:**
- Consumes: `startHostSession` (with `env`), `startFixture`, `probeReport`.
- Produces: `rewrite` probe reads `JEV_REWRITE_MODEL` and `JEV_REWRITE_THINKING` and, in `tool_call` for `subagent`, sets `event.input.model` and `event.input.thinking`. It records `tool_call` with `data: { model, thinking }` (identifiers only).

- [ ] **Step 1: Write the tests**, each launching `probe-worker` with original `model: "fixture/fixture-balanced"`, `thinking: "low"`, and the probe rewriting to `fixture/fixture-fast` and `high`:
  - `Q1 foreground: child request uses the rewritten model and thinking`: assert the first `fixture-*` child request's `model` and `reasoningEffort`.
  - `Q1 background: same with run_in_background true`: the script adds a follow-up `fixture-main` text reply for the completion notice. After `prompt` settles, `waitFor` the child's `fixture-fast` or `fixture-balanced` request, then assert.
  - `Q1 locked: agent file locking model`: launch `subagent_type: "probe-worker-locked"` with the same original parameters and rewrite env vars; `probe-worker-locked.md` declares `model: fixture/fixture-main` and `locked: model`; assert the child request `model` (`fixture-main` if the lock wins, `fixture-fast` if the rewrite wins).
  - `Q7 inherit_context with rewritten model`: the parent prompt contains `JEV-MARKER-7f3a`; launch with `inherit_context: true`; assert the child `model`, and whether `JSON.stringify(body.messages)` contains the marker.
  - Every test also asserts `fixture.unmatched` is empty.
- [ ] **Step 2: Observe and pin** per the observe-then-pin procedure (Task 4.8): run `bun test tests/host/q1-q7-worker-mutation.test.ts`, set `EXPECTED` per test, and append to `.observations.md`.
- [ ] **Step 3: Run** the test file 3 times. Expected: PASS each time; then run the full check set.
- [ ] **Step 4: Commit** as `Pin Q1 and Q7 host-seam answers`.

---

## Task 5: Message end ordering (Q2) — implements 4.2, 4.8

**Files:**
- Create: `tests/host/probes/ordering/{package.json,index.ts}`
- Test: `tests/host/q2-message-end-order.test.ts`

**Interfaces:**
- Produces: `ordering` probe records `message_end:start` and, after `await Bun.sleep(300)`, `message_end:end` for assistant messages containing a `subagent` call. It records `tool_call:start` with `data: { toolCallId }` for each `subagent` call.

- [ ] **Step 1: Write** `Q2: message_end completes before sibling tool_call preflight`: the main reply has two `subagent` calls, each child is matched on `fixture-fast`, and after `prompt` the test runs `waitFor` until two `tool_call:start` records exist. `EXPECTED.order` is the event-name sequence sorted by `seq`, initially `["message_end:start", "message_end:end", "tool_call:start", "tool_call:start"]`.
- [ ] **Step 2: Observe and pin** per the procedure. Expected after pinning: PASS across 3 runs, then the full check set.
- [ ] **Step 3: Commit** as `Pin Q2 host-seam answer`.

---

## Task 6: Child tool removal and child detection (Q3, Q4) — implements 4.3, 4.4, 4.8

**Files:**
- Create: `tests/host/probes/child/{package.json,index.ts}`
- Test: `tests/host/q3-q4-child.test.ts`

**Interfaces:**
- Produces: `child` probe subscribes to `pi.events.on("subagents:child:session-created")`, adds the event's `sessionId` to a `globalThis[Symbol.for("jev-probe.children")]` set, and records `child:session-created` with that `sessionId`. In `session_start`, it records `session_start` with `sessionId: ctx.sessionManager.getSessionId()`. In `before_agent_start`, when `ctx.sessionManager.getSessionId()` is in that set, it removes the tool named by `JEV_REMOVE_TOOL` from `event.systemPromptOptions.selectedTools` and records `tools:removed`.

- [ ] **Step 1: Write the tests**:
  - `Q3 removed tool absent from child request`: `JEV_REMOVE_TOOL=read`, and `probe-worker.md` declares `tools: read, grep`; assert whether the child request `toolNames` includes `read`.
  - `Q3 call to removed tool`: script the child to call `read` once, then text; assert whether the tool result in the child's second request is an error.
  - `Q4 session-created precedes child handlers with matching id`: assert that the `child:session-created` `sessionId` equals the child's `session_start` `sessionId`, and that its `seq` is lower.
- [ ] **Step 2: Observe and pin** per the procedure. Expected after pinning: PASS across 3 runs, then the full check set.
- [ ] **Step 3: Commit** as `Pin Q3 and Q4 host-seam answers`.

---

## Task 7: Hidden message and same-turn thinking (Q5, Q6) — implements 4.5, 4.6, 4.8

**Files:**
- Create: `tests/host/probes/main/{package.json,index.ts}`
- Test: `tests/host/q5-q6-main.test.ts`

**Interfaces:**
- Produces: `main` probe in `before_agent_start` returns `{ message: { customType: "jev-probe", content: "JEV-MARKER-5c1e", display: false } }` only while the file at `JEV_HIDDEN_FLAG` exists. It calls `pi.setThinkingLevel(process.env.JEV_SET_THINKING)` when that is set, and records `hidden:sent` or `thinking:set` (no content).

- [ ] **Step 1: Write the tests**:
  - `Q5 hidden message reaches the provider`: create the flag file; assert whether the first request's serialized `messages` contains `JEV-MARKER-5c1e`.
  - `Q5 after compaction`: `persist: true`, flag file present for prompt 1 only (delete it after prompt 1 settles). Run prompts 1 and 2 with text replies, then `send({ type: "compact" })` and await its response. The fixture answers the summarization request with an entry whose matcher is "no `tools` in the body, or a system prompt containing `summar` (case-insensitive)", placed before the generic `fixture-main` entry with `times: 1`; if the observed summarization request matches neither, adjust the matcher to the observed shape and note it. Then run prompt 3 and assert whether its request contains the marker.
  - `Q6 setThinkingLevel applies to the same turn`: session thinking `low`, `JEV_SET_THINKING=high`; assert the first request `reasoningEffort`.
- [ ] **Step 2: Observe and pin** per the procedure. Expected after pinning: PASS across 3 runs, then the full check set.
- [ ] **Step 3: Commit** as `Pin Q5 and Q6 host-seam answers`.

---

## Task 8: Q8 manual script — implements 5.1, 5.2, 5.3

**Files:**
- Create: `tests/host/manual/q8-claude-code.ts`
- Test: `tests/host/manual-excluded.test.ts`

**Interfaces:**
- Consumes: `tempDir`, `PI_BIN`, `spawnRpc` (Task 3).
- Produces: the Q8 script output contract.

- [ ] **Step 1: Write the failing test** `manual script is not collected`: assert that `tests/host/manual/q8-claude-code.ts` exists, does not match `/\.test\.ts$/`, and that no `package.json` script mentions `manual/`.
- [ ] **Step 2: Implement the script**:
  - Create a temp agent dir and run `pi install git:github.com/earendil-works/pi-claude-code@47f9e2b` (network allowed, manual only).
  - Run `--provider claude-code --model claude-haiku-5-5`, thinking `low`, with 3 fixed synthetic prompts. Then send `set_thinking_level` `high` and 3 more prompts.
  - Per turn, print level, thinking-related event names, and `cacheRead`, `cacheWrite` and `input` from the assistant message `usage`, falling back to `get_session_stats` deltas. Then print the versions line.
  - Remove the dir.
- [ ] **Step 3: Run** `bun test tests/host/manual-excluded.test.ts` and the full check set. Expected: PASS, and the script is not executed.
- [ ] **Step 4: Commit** as `Add manual Q8 claude-code cache script`.
- [ ] **Step 5: Operator run** (needs the operator): `bun tests/host/manual/q8-claude-code.ts`. Save stdout to a scratch file outside the repository for Task 9.

---

## Task 9: Evidence report and documents — implements 6.1, 6.2, 6.3, 6.4, 6.5

**Files:**
- Create: `docs/evidence/2026-11-05-host-seams.md` (from `tests/host/.observations.md` and the Q8 output; delete the scratch file afterward)
- Modify: `docs/architecture.md` (host seams table; child detection paragraph if contradicted), `docs/roadmap.md` (WG-02 status; affected groups), `docs/testing.md` (Host level: harness location and Q8 procedure), and any other `docs/` file an answer contradicts
- Test: `tests/host/evidence.test.ts`

- [ ] **Step 1: Write failing tests** in `tests/host/evidence.test.ts`:
  - `report answers every question`: the report has a table row for each `Q1` to `Q8`, each row's Level is one of `Unit|Contract|Host|Replay|Field` or the Answer is `Unsettled: ...`, and Q1 to Q7 rows cite a `tests/host/` file.
  - `no verify marker for settled seams`: the host seams table in `docs/architecture.md` contains no `**Verify**` on rows for `message_end`, `tool_call` mutation, `subagents:child:session-created` and `selectedTools`, unless the report marks that question unsettled.
  - `roadmap shows WG-02 done`: the WG-02 status row reads `Done`.
  - `report holds no markers or bodies`: the report contains no `JEV-MARKER-` string and no `"messages"` JSON.
  - `pinned tests name their question`: each `tests/host/q*.test.ts` file contains `WG-02 Q` in an assertion message.
  - `probe records hold no markers`: a helper in `harness.ts` checks every session's report file for `JEV-MARKER-` in `close()`, and throws if one is found; this test asserts the helper throws on a planted marker.
- [ ] **Step 2: Run** `bun test tests/host/evidence.test.ts`. Expected: FAIL.
- [ ] **Step 3: Write the report** from the pinned tests and the Q8 output, using the evidence report contract. Each question's section gives what was observed, the documents it changed, and the work groups it affects.
- [ ] **Step 4: Update the documents.** Replace each **Verify** with the answer (`Verified: yes`, `no` or `partial`, linking the report section). Fix any contradicted statement in `docs/` (for example WG-11's "batching at `message_end` or per-call per WG-02", if Q2 settles it). Mark WG-02 `Done`, and describe the harness and Q8 procedure under the Host level in `docs/testing.md`.
- [ ] **Step 5: Search** `docs/` for each contradicted claim: `rg -n "<claim keyword>" docs/`. Expected: no stale statement.
- [ ] **Step 6: Verify** `bun install --frozen-lockfile && bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all exit 0.
- [ ] **Step 7: Commit** `docs/ tests/host/evidence.test.ts` as `Record WG-02 host-seam evidence and update docs`.

---

## Scenario → test

**host-test-harness**
- Session runs in a fresh agent directory → `tests/host/harness.test.ts` › `agent dir is fresh and removed`
- Prompt completes against the fixture → `harness.test.ts` › `prompt settles against the fixture`
- Request fields are recorded → `tests/host/fixture.test.ts` › `records request fields`
- Tier models expose model and thinking → `harness.test.ts` › `prompt settles against the fixture` and `subagent call launches a child` (tier ids and `reasoning_effort` through real Pi)
- Server binds loopback only → `fixture.test.ts` › `binds loopback on an assigned port`
- Tool call launches a child → `harness.test.ts` › `subagent call launches a child`
- Unmatched request is visible → `fixture.test.ts` › `answers unmatched with an error`
- Executor installs offline → `harness.test.ts` › `installs executor offline`
- Executor and probe are loaded → `harness.test.ts` › `installs executor offline` (`subagent` in recorded `toolNames`) and `probe records are readable`
- Probe events are readable after the run → `harness.test.ts` › `probe records are readable`
- Executor version is exact → `tests/manifest.test.ts` › `executor is pinned exactly`
- Lockfile matches → CI step `bun install --frozen-lockfile` (Task 1 Step 4, Task 9 Step 6)

**host-seam-evidence**
- Changed host behavior fails the test → every pinned Q1–Q7 test (Tasks 4–7), each asserting fixed expected values
- Foreground launch → `q1-q7-worker-mutation.test.ts` › `Q1 foreground`
- Background launch → `q1-q7-worker-mutation.test.ts` › `Q1 background`
- Locked agent field → `q1-q7-worker-mutation.test.ts` › `Q1 locked`
- Sibling launches → `q2-message-end-order.test.ts` › `Q2`
- Removed tool is absent → `q3-q4-child.test.ts` › `Q3 removed tool absent from child request`
- Call to a removed tool → `q3-q4-child.test.ts` › `Q3 call to removed tool`
- Event precedes child handlers with matching id → `q3-q4-child.test.ts` › `Q4`
- Message reaches the provider → `q5-q6-main.test.ts` › `Q5 hidden message reaches the provider`
- After compaction → `q5-q6-main.test.ts` › `Q5 after compaction`
- Level set before the first request → `q5-q6-main.test.ts` › `Q6`
- Inherited context and rewritten model → `q1-q7-worker-mutation.test.ts` › `Q7`
- Script is not part of CI → `tests/host/manual-excluded.test.ts` › `manual script is not collected`
- Run records cache behavior around a level change → manual operator run (Task 8 Step 5), output cited in the report
- Every question answered or marked unsettled → `tests/host/evidence.test.ts` › `report answers every question`
- No settled seam left as verify → `evidence.test.ts` › `no verify marker for settled seams`
- No contradicted claim remains → Task 9 Step 5 search, reviewed at verify
- Roadmap reflects the group → `evidence.test.ts` › `roadmap shows WG-02 done`
