# WG-07 Main Effort Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Decide the main session's thinking level per eligible prompt from Jev's `effort`, `risky` and `corrects` answers, apply it before the first provider request, survive Jev failure and Esc unchanged, and record each decided turn in the ledger.

**Architecture:** A pure effort policy (`src/policy/effort.ts`), pure question and state builders (`src/jev/questions.ts`, `src/jev/state.ts`), a host context reader (`src/host/context.ts`) and one host module owning the turn lifecycle (`src/host/main.ts`) with injectable dependencies. `src/host/setup.ts` wires the four new handlers; `src/host/status.ts` gains the decision suffix (design D1–D11).

**Tech Stack:** TypeScript run by Pi 1.5.0, Bun 1.4.4 test runner, oxlint and oxfmt, `@gotgenes/pi-subagents` 25.0.5 (dev only, existing host tests).

## Global Constraints

- Public Pi APIs only. Only `src/host/` imports `@earendil-works/pi-coding-agent`; `src/policy/` imports only itself and `src/shared/`; `src/jev/` imports no `host/`, `store/` or Pi (`.oxlintrc.json`).
- No new dependency; nothing imported from `@earendil-works/pi-ai` (design D2). Ledger schema unchanged.
- Fixed numbers: risk floor `risky > 0.7`; ceiling `xhigh`; correction `corrects >= 0.7`; `recent` at most 4 messages and 2000 characters, newest assistant 55% (1100) with 72% of its cap from the end, others at least 200; `recent_tools` over the last 10 message entries.
- Never put prompt text, conversation text, tool arguments or output in the ledger or in a session entry. The `jev-turn` entry data is exactly `{ turnId }`.
- Every handler catches its own errors and writes nothing to stdout or stderr.
- Tests need no secrets, paid calls or network beyond loopback; the key is a dummy such as `test-key`.
- English in code, comments, docs and commit messages.

## Review Focus

1. **A follow-up message queued while Jev answers** (RPC `prompt` with `streamingBehavior: "followUp"` during the wait). Expected: Pi queues it into the starting run (Pi 1.5.0 changelog), so it fires no `before_agent_start` of its own; the run settles once and writes one `main` line. Test added to Task 9 (`followup`: held route, send a follow-up during the wait, release → exactly one Jev request and one `main` line).
2. **Model switched during the wait** (`/model` while Jev is held). Expected: `pi.getThinkingLevel()` may change by clamping; that counts as a manual change and the result is discarded. Test added to Task 6 (unit: `getThinkingLevel` returns a different value after `askJev` → no `setThinkingLevel`).
3. **Very long prompt** (100 000 characters). Expected: the request is still sent; `request.text` is the full prompt but `recent` budgets apply only to history; `files_mentioned` stays linear. Test added to Task 3 (`requestSignals` on a 100 000-character prompt returns within 50 ms).
4. **Branch entries Pi adds that are not messages** (`thinking_level_change`, `model_change`, `compaction`, `branch_summary`, labels). Expected: ignored by `branchItems` and not counted in `recent_tools`. Test added to Task 4.
5. **Ledger write fails mid-way** (directory read-only). Expected: no throw, `appendEntry` still records the turn id so the next correction works. Test added to Task 7.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `EffortLevel` | new | `"low" \| "medium" \| "high" \| "xhigh" \| "max"` in `src/policy/effort.ts` | no |
| `ThinkingLevel` (local) | new | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"`, exported as `LEVELS` (ordered) from `src/policy/effort.ts` | no |
| constants | new | `EFFORT_LEVELS: readonly EffortLevel[]`, `RISK_FLOOR = 0.7`, `EFFORT_CEILING: EffortLevel = "xhigh"`, `CORRECTION_THRESHOLD = 0.7` | no |
| `supportedLevels` | new | `(m: { reasoning: boolean; thinkingLevelMap?: Partial<Record<ThinkingLevel, string \| null>> }) => ThinkingLevel[]` | no |
| `clampLevel` | new | `(level: ThinkingLevel, supported: readonly ThinkingLevel[]) => ThinkingLevel` (supported → itself; else nearest above; else nearest below; empty → `"off"`) | no |
| `decideEffort` | new | `(i: { choice: EffortLevel; risky?: number; supported: readonly ThinkingLevel[] }) => { requested: EffortLevel; target: ThinkingLevel }` | no |
| `canAskEffort` | new | `(supported: readonly ThinkingLevel[]) => boolean` (at least two of `low`..`max`) | no |
| `MainQuestions` | new | `{ wire: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> }`, `WireQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> } \| { type: "noul"; instructions: string; criteria: { true: string; false: string } }` | no |
| `mainQuestions` | new | `(o: { askEffort: boolean }) => MainQuestions`; key order `effort`, `risky`, `corrects` | no |
| Jev main request body | new | `{ model, state: MainState, questions: MainQuestions["wire"] }` sent through `askJev` | yes (outbound wire format to TypeSafe) |
| `BranchItem` | new | `{ role: "user" \| "assistant" \| "toolResult"; text: string; tools: { name: string; failed?: true }[]; isError?: boolean }` | no |
| `RequestSignals` | new | `{ text: string; prompt_chars: number; files_mentioned: number; has_code_or_error: boolean; is_question: boolean }` | no |
| `MainState` | new | `{ request: RequestSignals; conversation: { recent: { role: "user" \| "assistant"; text: string; tools: { name: string; failed?: true }[] }[]; recent_tools: { edits: number; commands: number; reads: number; subagents: number; failed: number }; turn_index: number }; workspace: { platforms: string[] } }` | yes (outbound, see `docs/privacy.md`) |
| `requestSignals` / `recentMessages` / `recentTools` / `turnIndex` / `mainState` | new | `(prompt: string) => RequestSignals` / `(items: BranchItem[]) => MainState["conversation"]["recent"]` / `(items: BranchItem[]) => MainState["conversation"]["recent_tools"]` / `(items: BranchItem[]) => number` / `(i: { prompt: string; items: BranchItem[]; platforms: string[] }) => MainState` | no |
| `branchItems` / `previousTurnId` / `scanPlatforms` | new | `(entries: readonly SessionEntry[]) => BranchItem[]` / `(entries: readonly SessionEntry[]) => string \| undefined` / `(cwd: string) => string[]` in `src/host/context.ts` | no |
| `jev-turn` custom entry | new | `pi.appendEntry("jev-turn", { turnId: string })`; session file format addition, never sent to the model | yes (persisted in session files) |
| `Decision` | new | `{ kind: "level"; level: ThinkingLevel } \| { kind: "no-answer" }` | no |
| `statusText` | modified | `(s: Snapshot, decision?: Decision) => string` | no |
| `drawStatus` | modified | `(ctx, s: Snapshot, decision?: Decision) => void` | no |
| `MainDeps` | new | `{ load: () => Snapshot; ask: typeof askJev; append: (entry: unknown) => WriteResult; now: () => number; newId: () => string; platforms: (cwd: string) => string[]; env: () => Record<string, string \| undefined> }` | no |
| `createMain` | new | `(pi: ExtensionAPI, deps: MainDeps) => { beforeAgentStart; beforeProviderRequest; turnEnd; agentSettled; sessionStart: () => void; decision: () => Decision \| undefined }` in `src/host/main.ts` | no |
| `runJev` deps | modified | `deps` gains `decision: () => Decision \| undefined` so the `/jev` redraw keeps the suffix | no |
| Extension registrations | modified | handlers `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end`, `agent_settled`; command `jev` | yes |
| Status line text | modified | `Jev · <mode>[ · <level> \| · no answer]` | yes |
| `FixtureRoute` (test) | modified | adds `{ held: Promise<FixtureRoute> }`: the response waits for the promise | no |

---

## Task 0: Workspace — implements 0.1

- [ ] **Step 1:** Run `bun install`. Expected: `node_modules/.bin/pi` exists.
- [ ] **Step 2:** Run `bun test tests/load.test.ts`. Expected: PASS. No commit.

---

## Task 1: Effort policy — implements 1.1

**Files:** Create `src/policy/effort.ts`; Test `tests/policy/effort.test.ts`.

**Interfaces:** Produces `LEVELS`, `EffortLevel`, `ThinkingLevel`, constants, `supportedLevels`, `clampLevel`, `decideEffort`, `canAskEffort`.

- [ ] **Step 1: Write failing tests**, one per scenario:
  - `supportedLevels({ reasoning: true })` → `["off","minimal","low","medium","high"]`; with map `{ xhigh: "x", minimal: null }` → `["off","low","medium","high","xhigh"]`; `{ reasoning: false }` → `["off"]`.
  - Pinned table from Pi 1.5.0 `clampThinkingLevel` (copy cases from `node_modules/@earendil-works/pi-ai/dist/models.js`): `clampLevel("xhigh", off..high)` → `high`; `clampLevel("low", ["off","medium","high"])` → `medium`; `clampLevel("max", ["off"])` → `off`; `clampLevel("minimal", ["off","low"])` → `low`.
  - `decideEffort`: `medium`/0.2 on `off..high` → `{ requested: "medium", target: "medium" }`; `low`/0.71 → requested `high`; `low`/0.7 → `low`; `xhigh`/0.9 on a map with `xhigh` → `xhigh`; `max` → requested `xhigh`; `xhigh` on `off..high` → target `high`; `low` with `low: null` → target `medium`; `low` with `risky` undefined → `low`; the confidence scenario is covered by `decideEffort` taking no confidence input (a call with an extra `confidence` key under `// @ts-expect-error`, checked by `bun run typecheck`).
  - Note: `decideEffort` deliberately takes no `current` level (design D1 lists one); the host owns the "same level" and "max kept" rules (Task 6). Do not add it.
  - `canAskEffort(["off"])` false; `(["off","low"])` false; `(["off","low","medium"])` true.
- [ ] **Step 2:** `bun test tests/policy/effort.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** with the signatures from Contracts. `xhigh`/`max` need `thinkingLevelMap[level]` neither `undefined` nor `null`; other levels need it not `null`.
- [ ] **Step 4:** → PASS. **Step 5:** Commit `feat(policy): add main effort rule`.

---

## Task 2: Main questions — implements 2.1

**Files:** Create `src/jev/questions.ts`; Test `tests/jev/questions.test.ts`.

**Interfaces:** Consumes `EFFORT_LEVELS`, `QuestionSpec`. Produces `mainQuestions`, `MainQuestions`, `WireQuestion`.

- [ ] **Step 1: Write failing tests:** `askEffort: true` → `Object.keys(wire)` equals `["effort","risky","corrects"]`; `wire.effort` keys exactly `type`, `instructions`, `criteria`; `Object.keys(wire.effort.criteria)` equals the five levels in order and each value equals the `docs/jev-questions.md` criterion text; `wire.risky.criteria` keys exactly `true`, `false`; `specs.effort` is `{ type: "choice", options: EFFORT_LEVELS }`; `askEffort: false` → keys exactly `["corrects"]`. A test reads `docs/jev-questions.md` and asserts each instruction string appears verbatim in it.
- [ ] **Step 2:** → FAIL. **Step 3: Implement** with the wording copied verbatim from `docs/jev-questions.md` (`effort` main instruction and five criteria; `risky` instruction with `true`/`false`; `corrects` instruction with `true`/`false`). **Step 4:** → PASS. **Step 5:** Commit `feat(jev): add main question set`.

---

## Task 3: Main state — implements 2.2, 2.3, 2.4

**Files:** Create `src/jev/state.ts`; Test `tests/jev/state.test.ts`.

**Interfaces:** Consumes `BranchItem` (declared in `src/jev/state.ts`, re-used by `host/context.ts`). Produces `RequestSignals`, `MainState`, `requestSignals`, `recentMessages`, `recentTools`, `turnIndex`, `mainState`.

- [ ] **Step 1: Failing tests for `requestSignals`:** `"  why does src/a.ts fail?  "` → `{ prompt_chars: 23, files_mentioned: 1, has_code_or_error: false, is_question: true }`; `"the build failed with TypeError"` → `has_code_or_error: true`; `"see README.md and README.md"` → `files_mentioned: 1`; `"rename foo to bar"` → `0, false, false`; `"at src/x.ts:12"` → `has_code_or_error: true`; `"Should we?"` → `is_question: true`; Review Focus 3: a 100 000-character prompt completes in under 50 ms.
- [ ] **Step 2: Failing tests for `recentMessages`:** `hi`/`hello` → exact array from the spec; 5000-character newest assistant `START…END?` → text length ≤ 1100 including the marker, contains `START` and `END?`; six 900-character messages → at most 4, total ≤ 2000, newest present, none shorter than 200 unless it is whole; a `bash` call with `JEV-MARKER-ARG` and an error result → `tools` `[{ name: "bash", failed: true }]` and `JSON.stringify(state)` lacks the marker; `toolResult` items never appear as messages.
- [ ] **Step 3: Failing tests for `recentTools`, `turnIndex`, `mainState`:** the counts scenario → `{ edits: 1, commands: 2, reads: 1, subagents: 0, failed: 1 }`; `web_search` counts as `reads`; only the last 10 items count; empty items → `turn_index` 0 and `recent` `[]`; `mainState` keys exactly `request`, `conversation`, `workspace` with the nested key sets from the spec.
- [ ] **Step 4:** → FAIL. **Step 5: Implement.** Elision joins start and end with `" … "` (counted in the cap). Messages are taken newest first until the budget or 4 messages is reached, then reversed. **Step 6:** → PASS. **Step 7:** Commit `feat(jev): build minimal main state`.

---

## Task 4: Host context — implements 3.1, 3.2

**Files:** Create `src/host/context.ts`; Test `tests/host/context.test.ts`.

**Interfaces:** Consumes `BranchItem`. Produces `branchItems`, `previousTurnId`, `scanPlatforms`.

- [ ] **Step 1: Failing tests for `branchItems`** with hand-built `SessionEntry` objects (cast): user text → `{ role: "user", text }`; assistant with text, thinking and a `toolCall` → text only plus `tools: [{ name }]`; a later `toolResult` with `isError: true` marks that call `failed: true` and yields a `toolResult` item with `isError: true`; `custom_message`, `custom`, `thinking_level_change`, `model_change`, `compaction`, `branch_summary`, `label` entries produce nothing (Review Focus 4); image parts are dropped.
- [ ] **Step 2: Failing tests for `previousTurnId`:** two `jev-turn` entries → the later id; a branch that ends at T1's `jev-turn` entry (T2 lives on a sibling path not passed in) → `T1` ("Other branch"); one with data `{ turnId: 7 }` → ignored; none → `undefined`.
- [ ] **Step 3: Failing tests for `scanPlatforms`** in temp dirs: `Dockerfile` + `.github/workflows/` → `["Docker","GitHub Actions"]`; `web/vercel.json` → `["Vercel"]`; `apps/web/vercel.json` only → `["none found"]`; `node_modules/fly.toml` only → `["none found"]`; a symlinked directory containing `fly.toml` → not counted; an unreadable subdirectory (`chmod 000`, skipped as root) → no throw.
- [ ] **Step 4:** → FAIL. **Step 5: Implement** (`readdirSync(..., { withFileTypes: true })`, `isSymbolicLink()` skipped; marker table as data in the order of `docs/jev-contract.md`). **Step 6:** → PASS. **Step 7:** Commit `feat(host): read branch items and workspace platforms`.

---

## Task 5: Status suffix — implements 5.1 (pure part)

**Files:** Modify `src/host/status.ts`; Test `tests/host/status.test.ts`.

**Interfaces:** Produces `Decision`, modified `statusText`, `drawStatus`.

- [ ] **Step 1: Failing tests:** `statusText(ready, { kind: "level", level: "high" })` → `"Jev · standard · high"`; `{ kind: "no-answer" }` → `"Jev · standard · no answer"`; with `effort` off → `"Jev · standard"`; all off → `"Jev · off"`; no decision → unchanged base texts (all existing tests still pass); `drawStatus` in RPC with a decision → `widgetLines` `["Jev · standard · xhigh"]`.
- [ ] **Step 2:** → FAIL. **Step 3: Implement.** **Step 4:** → PASS. **Step 5:** Commit `feat(status): show the main decision`.

---

## Task 6: Main decision — implements 4.1, 4.2, 4.4

**Files:** Create `src/host/main.ts`; Test `tests/host/main.test.ts`.

**Interfaces:** Consumes `loadSnapshot`, `askJev`, `readAnswers`, `mainQuestions`, `mainState`, `branchItems`, `previousTurnId`, `supportedLevels`, `decideEffort`, `canAskEffort`, `isChild`, `drawStatus`. Produces `MainDeps`, `createMain` (handlers used by Task 8).

Fake `pi`: `getThinkingLevel`/`setThinkingLevel` over a variable with a clamp to a supported list, `appendEntry` recorder. Fake `ctx`: `sessionManager.getSessionId()`, `getBranch()`, `model` `{ reasoning: true }`, `cwd`, `hasUI`, `mode: "rpc"`, `ui.setWidget` recorder. Fake `ask` returns scripted outcomes; the held variant resolves on demand.

- [ ] **Step 1: Failing eligibility tests:** request sent once for a user prompt; none for `effort` off, `messageType: "custom"`, child id, key unset, `"   "`, invalid config, `ctx.model` undefined; each of those leaves the level and the status recorder untouched.
- [ ] **Step 2: Failing decision tests:** level `low`, answer `xhigh`/0.1 on `xhigh`-capable model → `setThinkingLevel("xhigh")` called once and the widget shows `· xhigh` before the handler returns; target equals current → `setThinkingLevel` not called; `max` current with answer `low` → not called; non-reasoning model → wire questions exactly `corrects` and no level call; request `questions` and `state` match `mainQuestions`/`mainState` outputs; `signal` passed is `ctx.signal`.
- [ ] **Step 3: Failing discard and failure tests:** level changed between `ask` start and return (operator `medium`) → no call and the widget keeps its previous suffix; a following prompt answered `high` → `setThinkingLevel("high")` ("discard then next prompt applies"); non-reasoning model with a timeout → widget `· no answer` ("non-reasoning miss"); non-reasoning model answered after a `high` decision → widget still `· high` ("non-reasoning answered"); Review Focus 2: level changed by a fake model switch → no call; `miss` `error` and `timeout` → no call, widget `· no answer`; `effort` with unknown choice → no call, widget `· no answer`; `cancelled` → no call, no widget change, record dropped.
- [ ] **Step 4: Failing Esc tests:** apply `high` from `low`, no `beforeProviderRequest`, then `agentSettled({ aborted: true })` → `setThinkingLevel("low")`; same but operator set `medium` after the apply → no restore; after `beforeProviderRequest`, aborted settle → no restore.
- [ ] **Step 5: Failing error test:** `getBranch` throws → handler resolves, no level call, no throw (`expect(...).resolves`).
- [ ] **Step 6:** → FAIL. **Step 7: Implement** per design D3–D5 and D10; one record per instance, replaced only in `beforeAgentStart`; `sessionStart()` clears the stored decision. **Step 8:** → PASS. **Step 9:** Commit `feat(host): decide main effort before each prompt`.

---

## Task 7: Ledger path — implements 4.3

**Files:** Modify `src/host/main.ts`; Test `tests/host/main.test.ts`.

**Interfaces:** Consumes `appendLedger` (through `deps.append`), `validateLedgerEntry`.

- [ ] **Step 1: Failing tests** (every appended entry passes `validateLedgerEntry`):
  - applied: `turnEnd` with two tool results, one `isError`, usage `{ input: 10, output: 5 }` twice, then `agentSettled({ aborted: false })` → one `main` line with `answered: true`, `from: "low"`, `requested: "high"`, `effective: "high"`, five `effortP` keys, `risky: 0.1`, `corrects: 0.05`, `toolCalls: 2`, `failures: 1`, `inputTokens: 20`, `outputTokens: 10`, `outcome: "ok"`, `durationMs` from the fake clock; then `appendEntry("jev-turn", { turnId })` with the same id;
  - effective read back: fake Pi clamps `xhigh` to `high` → `requested: "xhigh"`, `effective: "high"`;
  - miss: `answered: false`, `miss: "timeout"`, `from` set, no `requested`/`effective`/`effortP`;
  - discarded: `requested`, `effortP`, no `effective`;
  - aborted after a provider request → `outcome: "aborted"`; settled not aborted with no provider request and an error last assistant (`stopReason: "error"`) → one line, `outcome: "error"`;
  - correction: branch holds `jev-turn` `T1`, answer `corrects: 0.9` → a `correction` line `{ turnId: "T1", corrects: 0.9 }` appended before the `main` line; `0.69` → none; no `jev-turn` on the branch → none; aborted before any provider request → no `correction`, no `main`, no `appendEntry`;
  - no line contains `held`, `advised`, `strategy`, `strategyP`, `skill`, `skillP` or `gate`;
  - privacy: prompt `JEV-MARKER-PROMPT` → no appended entry or `appendEntry` data contains it;
  - Review Focus 5: `deps.append` returns `{ ok: false }` → no throw and `appendEntry` still called.
- [ ] **Step 2:** → FAIL. **Step 3: Implement** per design D6–D7. **Step 4:** → PASS. **Step 5:** Commit `feat(host): record main turns in the ledger`.

---

## Task 8: Wiring — implements 5.1 (redraw), 5.2

**Files:** Modify `src/host/setup.ts`, `src/host/commands.ts`; Test `tests/load.test.ts`, `tests/host/setup.test.ts`, `tests/host/commands.test.ts`.

**Interfaces:** Consumes `createMain`. Produces the registrations in Contracts.

- [ ] **Step 1: Failing tests:** `tests/load.test.ts` handlers equal `["agent_settled","before_agent_start","before_provider_request","session_shutdown","session_start","turn_end"]`, commands `["jev"]`, no tools, flags or shortcuts; `tests/host/setup.test.ts` with a fake `pi` asserts the same and that `session_start` calls `sessionStart()` before drawing; `tests/host/commands.test.ts`: `runJev` redraw with `deps.decision` returning `{ kind: "level", level: "high" }` after `skills off` → `["Jev · standard · high"]`, after `effort off` → `["Jev · standard"]`.
- [ ] **Step 2:** → FAIL. **Step 3: Implement** with real deps (`loadSnapshot`, `askJev`, `(e) => appendLedger(jevDir(), e)`, `Date.now`, `crypto.randomUUID`, `scanPlatforms`, `() => process.env`). **Step 4:** → PASS. **Step 5:** Commit `feat(host): wire the main decision`.

---

## Task 9: Host tests through the real CLI — implements 6.1–6.5

**Files:** Modify `tests/jev/fixture.ts`, `tests/host/harness.ts`; Create `tests/host/main-effort.test.ts`.

**Interfaces:** Consumes `startJevFixture`, `startFixture`, `startHostSession({ self: true, env })`.

- [ ] **Step 1:** Add the `held` route to `tests/jev/fixture.ts` with a unit test in `tests/jev/client.test.ts` (answer arrives only after release). Let `startHostSession` accept `jevConfig: { url: string; timeoutMs: number }` and write `<agentDir>/jev/config.json` as exactly `{ "classifier": { "url": <url>, "timeoutMs": <timeoutMs> } }` (key variable stays `TYPESAFE_API_KEY`). `isolatedEnv` drops the ambient environment, so pass `TYPESAFE_API_KEY: "test-key"` through `env`; each test asserts the start widget reads `Jev · standard` (not `no key`).
- [ ] **Step 1b:** In `fixtureModelsJson` give `fixture-main` `thinkingLevelMap: { xhigh: "xhigh", max: "max" }`, so `xhigh` and `max` are supported and recorded verbatim in `reasoningEffort`. Run the existing host tests (`bun test tests/host`) to confirm nothing else depended on the old map; confirm `--thinking max` is accepted for `fixture-main`.
- [ ] **Step 2: Write `tests/host/main-effort.test.ts`** (each case its own session; read provider requests from the fixture, the ledger from `<agentDir>/jev/ledger.jsonl`, state with RPC `get_state`):
  - `level on first request`: Jev `effort: xhigh`, `risky: .1`, `corrects: .05` → first provider request `reasoningEffort` `xhigh` and `model` `fixture-main`; a `setWidget` `jev` `["Jev · standard · xhigh"]` event precedes it.
  - `risk floor`: `low`/`.8` → `high`.
  - `max kept`: start with `thinking: "max"` on `fixture-main` → first request `max`; ledger `requested: "low"`, `effective: "max"`.
  - `jev down 500`: provider request bodies equal those of a run on the same cwd without the package (`self: false`), ignoring ids and timestamps; widget `· no answer`; one `main` line `answered: false`, `miss: "error"`.
  - `jev timeout`: held route never released, `timeoutMs: 300` → first provider request within 800 ms of `prompt`.
  - `esc`: `timeoutMs: 5000`, held route; send `prompt`, wait until the Jev fixture recorded the request, send `abort` **without awaiting its response** (RPC `abort` waits for idle, which needs the handler to return), release with `xhigh`, then await the abort response and the `agent_settled` event → no provider request recorded; `get_state` thinking level equals the start level; the ledger holds no `main` line.
  - `discard`: held route; after the Jev request send `set_thinking_level` `medium`, then release with `xhigh` → first request `medium`; line has `requested: "xhigh"` and no `effective`.
  - `correction`: two prompts, second answered `corrects: .9` → a `correction` line whose `turnId` equals the first `main` line's `turnId`.
  - `privacy`: prompt contains `JEV-MARKER-PROMPT` → absent from ledger files and from every `custom` entry in the session file (`persist: true`).
  - `followup` (Review Focus 1): held route; send `{ type: "prompt", message, streamingBehavior: "followUp" }` through `send` during the wait; script a provider reply for each turn; release → exactly one Jev request and one `main` line.
- [ ] **Step 3:** `bun test tests/host/main-effort.test.ts` → PASS (run twice to check stability). **Step 4:** Commit `test(host): prove main effort through the real CLI`.

---

## Task 10: Upstream issue draft — implements 7.1

- [ ] **Step 1:** Write `openspec/changes/wg-07-main-effort/upstream-issue.md`: title `ctx.signal is undefined in before_agent_start`; Pi version 1.5.0; where (`_startRun` → `_prepareRun` before `agent.prompt`; `getSignal: () => this.agent.signal`); impact (extensions awaiting network work there cannot react to Esc; Pi already aborts at `agent_start`); request (a signal aborted when the starting run is aborted, exposed as `ctx.signal`); a minimal repro with a sleeping handler. No prompts or account data. Do not post.
- [ ] **Step 2:** Commit `docs: draft upstream issue for a before_agent_start signal`.

---

## Task 11: Documentation — implements 8.1, 8.2 (8.3 runs after archive)

- [ ] **Step 1:** `docs/evidence/2026-11-05-host-seams.md`: add a section on the `before_agent_start` signal (source reading at Pi 1.5.0; host test `tests/host/main-effort.test.ts` `esc`).
- [ ] **Step 2:** `docs/architecture.md` host seams rows `before_provider_request` (Esc restore) and `agent_settled` (turn end, restore), failure model row for Esc (restore level, no line); `docs/workflow.md` main prompt flow (restore on Esc, status line); `docs/usage-guide.md` decision text; `docs/jev-questions.md` wire format; `docs/roadmap.md` WG-07 status.
- [ ] **Step 3:** Commit `docs: document main effort`. Step 8.3 is recorded for `/opsx-archive`.

---

## Task 12: Checks — implements 9.1

- [ ] **Step 1:** `bun run typecheck && bun run lint && bun run fmt:check && bun test` → all pass. No commit unless formatting changed.

---

## Scenario → test

**main-effort**
- User prompt with effort on → `tests/host/main.test.ts` eligibility "request sent once"; `tests/host/main-effort.test.ts` `level on first request`
- Effort off → `main.test.ts` eligibility "effort off"
- Run started by a custom message → `main.test.ts` eligibility "custom"
- Child session → `main.test.ts` eligibility "child"
- No key → `main.test.ts` eligibility "key unset"
- Empty prompt → `main.test.ts` eligibility "whitespace"
- Invalid config → `main.test.ts` eligibility "invalid config"
- Reasoning model → `tests/jev/questions.test.ts` "askEffort true"
- Non-reasoning model → `questions.test.ts` "askEffort false"; `main.test.ts` "non-reasoning"
- Choice shape → `questions.test.ts` "effort keys"
- Noul shape → `questions.test.ts` "risky criteria"
- Reasoning model without a map → `tests/policy/effort.test.ts` "supportedLevels default"
- Map enables xhigh and disables minimal → `effort.test.ts` "supportedLevels map"
- Not a reasoning model → `effort.test.ts` "supportedLevels non-reasoning"
- Choice applies as is → `effort.test.ts` "medium"
- Risk floor → `effort.test.ts` "0.71"
- Risk floor boundary → `effort.test.ts` "0.7"
- Risk floor does not lower → `effort.test.ts` "xhigh 0.9"
- Ceiling → `effort.test.ts` "max"
- Clamp down → `effort.test.ts` "clamp down"
- Clamp up → `effort.test.ts` "clamp up"
- Risky unanswered → `effort.test.ts` "risky undefined"
- Low confidence still applies → `effort.test.ts` "no confidence input" (type test)
- Level on the first request → `main-effort.test.ts` `level on first request`
- Same level → `main.test.ts` "target equals current"
- Model unchanged → `main-effort.test.ts` `level on first request` (model field equals the selected model)
- Operator set max → `main-effort.test.ts` `max kept`; `main.test.ts` "max current"
- Operator changes the level while Jev answers → `main-effort.test.ts` `discard`; `main.test.ts` "operator medium"
- Next prompt decides again → `main.test.ts` "discard then next prompt applies"
- Jev returns 500 → `main-effort.test.ts` `jev down 500`
- Jev times out → `main-effort.test.ts` `jev timeout`
- Effort unanswered → `main.test.ts` "unknown choice"
- Esc during classification → `main-effort.test.ts` `esc`; `main.test.ts` Esc "restore"
- Operator change after the apply is kept → `main.test.ts` Esc "no restore after operator change"
- Client reports cancelled → `main.test.ts` "cancelled"
- Abort after the provider request → `main.test.ts` Esc "after provider request"; Task 7 "aborted"
- Throwing state build → `main.test.ts` "getBranch throws"

**main-state**
- Field set → `tests/jev/state.test.ts` "mainState keys"
- Question with a file → `state.test.ts` "why does src/a.ts fail"
- Error text → `state.test.ts` "build failed"
- Same file twice → `state.test.ts` "README twice"
- Plain instruction → `state.test.ts` "rename"
- Short history → `state.test.ts` "hi hello"
- Tool arguments never sent → `state.test.ts` "JEV-MARKER-ARG"
- Injected context excluded → `tests/host/context.test.ts` "custom_message skipped"
- Long assistant reply keeps both ends → `state.test.ts` "5000 START END"
- Budget drops the oldest → `state.test.ts` "six 900"
- Counts → `state.test.ts` "recentTools counts"
- First prompt → `state.test.ts` "empty items"
- Docker and GitHub Actions → `context.test.ts` "Dockerfile workflows"
- Marker one level down → `context.test.ts` "web/vercel.json"
- Marker two levels down → `context.test.ts` "apps/web/vercel.json"
- Path-shaped marker → `context.test.ts` "Dockerfile workflows" (`.github/workflows/` at the root)
- Skipped directory → `context.test.ts` "node_modules"

**main-ledger**
- Decided turn → `main.test.ts` Task 7 "applied"
- Ineligible prompt → `main.test.ts` eligibility "effort off" (no append)
- Run fails before any provider request → `main.test.ts` Task 7 "error outcome"
- Ledger directory unwritable → `main.test.ts` Task 7 "append fails"
- Required fields → `main.test.ts` Task 7 (every entry validated)
- Effective is read back from Pi → `main.test.ts` Task 7 "clamped read back"
- Applied decision → `main.test.ts` Task 7 "applied"
- Miss → `main.test.ts` Task 7 "miss"
- Discarded → `main.test.ts` Task 7 "discarded"; `main-effort.test.ts` `discard`
- Aborted after the request → `main.test.ts` Task 7 "aborted"
- Entry after a decided turn → `main.test.ts` Task 7 "applied" (`appendEntry`)
- Correction of the previous turn → `main.test.ts` Task 7 "correction"; `main-effort.test.ts` `correction`
- Correction in a cancelled turn → `main.test.ts` Task 7 "aborted before request"
- Boundary → `main.test.ts` Task 7 "0.69"
- First prompt of a session → `main.test.ts` Task 7 "no jev-turn"
- Other branch → `context.test.ts` "previousTurnId later id" (branch ending at T1's entry)
- Branch before any turn entry → `context.test.ts` "previousTurnId none"
- Marker absent → `main-effort.test.ts` `privacy`; `main.test.ts` Task 7 "privacy"

**status-line**
- Ready with the default mode, Mode from state, No key, Config error wins over no key, Everything off, One feature off is not off, No executor is not shown, Malformed state uses defaults → existing `tests/host/status.test.ts` cases (unchanged)
- After a decision → `status.test.ts` "level high"
- After a miss → `status.test.ts` "no-answer"
- Discarded keeps the previous suffix → `main.test.ts` "operator medium" (widget unchanged)
- Miss on a non-reasoning model → `main.test.ts` "non-reasoning miss"
- Answered without effort keeps the suffix → `main.test.ts` "non-reasoning answered"
- Kept across /jev → `commands.test.ts` "redraw keeps decision"
- Effort switched off → `status.test.ts` "effort off"; `commands.test.ts` "effort off redraw"
- Session start clears the suffix → `setup.test.ts` "session_start clears"
- Base state wins → `status.test.ts` "all off"
- Drawn at session start in RPC mode, Right-aligned in the terminal UI, Narrow terminal, Refreshed after a switch change → existing `status.test.ts` and `tests/host/jev-base.test.ts` cases
- Refreshed after a decision → `main-effort.test.ts` `level on first request`

**package-loading**
- Loaded extension registers only /jev and handlers → `tests/load.test.ts`
