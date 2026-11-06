# WG-11 Worker Host Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`worker-routing`, `worker-ledger`, `worker-decision`, `config-file`, `settings-resolution`) and `design.md`.

**Goal:** Route every `subagent` launch in a main Pi session through Jev's answers. Handle forked, resumed and locked launches, cascade unusable tiers with a warning, fail open, and record one ledger line per launch.

**Architecture:**
- `policy/route.ts` combines the existing decision, fallback and effort functions with a pure thinking clamp into one `routeLaunch`.
- `host/worker.ts` is the only stateful part. It does the following:
  - reads the gate;
  - batches Jev requests at `message_end`, or asks at `tool_call` for uncached launches;
  - checks the registry;
  - mutates input;
  - warns;
  - joins the executor's outcome to a ledger line.
- The store gains one setting.

**Tech Stack:**
- TypeScript, Bun (`bun test`), oxlint boundary rules.
- `@earendil-works/pi-coding-agent` 1.5.0 (`ExtensionAPI`, `ctx.modelRegistry`, `ctx.ui.notify`, `ctx.signal`, `getAgentDir`).
- `@gotgenes/pi-subagents` 25.0.5, used through events only.
- `@earendil-works/pi-ai` 1.5.0, imported only by a parity test (already installed as Pi's dependency).

## Global Constraints

- **Import boundaries** (`.oxlintrc.json`):
  - `policy/` imports only itself and `shared/`.
  - `jev/` never imports `host/`, `store/` or Pi.
  - Only `host/` imports Pi.
  - `src/` must not import `@earendil-works/pi-ai`. It is not a declared dependency; lint does not catch this in `host/`, so reviewers check it.
- **Fail open.** Every Jev failure, internal error, missing key, invalid config, absent executor, child session or switched-off feature leaves `subagent` input byte-for-byte as the caller sent it.
- **Ledger.** It never contains prompt text, briefs, descriptions or tool arguments. The format in `src/store/ledger-schema.ts` is not changed.
- **No new dependency in `package.json`.**
- **Tests** need no secrets, paid calls or network beyond loopback.
- **Language.** Everything in the repository is English.
- **Imports.** Relative imports in `src/` and `tests/` use the `.ts` extension.
- **No retries.** Errors while a child runs are not retried.

## Review Focus

These inputs are not covered by a spec scenario but are most likely to bite. Each has a test in the owning task.

- **A launch blocked by another extension's `tool_call` handler.** It never gets a tool result, so its draft must not leak or be written. Test "Drafts are bounded" in Task 5.
- **Two siblings with the same `subagent_type`** must each get their own decision and ledger line. Test "Two launches" in Task 4, which asserts two distinct cache entries and, in Task 5, two ledger lines.
- **A `tiers.*` value without `/`, or with more than one `/`** (`openrouter/anthropic/claude`). The split is at the first `/`, so the remainder is the id. Test "Model id with a slash" in Task 4.
- **`subagents:completed` for an agent this package did not route** (switch was off, or the agent was started by `SubagentsService.spawn`) must not write a line or throw. Test "Unknown agent id ignored" in Task 5.
- **The operator aborting while `message_end` waits on Jev.** The `tool_call` must not then re-ask Jev; the cancelled cache entry means skip. Test "Cancelled batch not re-asked" in Task 4.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `config.json` `subagents.forkedLaunch` | new | Optional `"untouched" \| "thinking"`, inside a new optional `subagents` object. No other key under `subagents` | yes (operator-approved during explore) |
| `Config` (`src/store/config.ts`) | modified | Adds `subagents?: { forkedLaunch?: "untouched" \| "thinking" }` | no |
| `DEFAULTS` (`src/store/defaults.ts`) | modified | Adds `subagents: { forkedLaunch: "untouched" }` | no |
| `Settings` (`src/store/settings.ts`) | modified | Adds `subagents: { forkedLaunch: "untouched" \| "thinking" }` | no |
| `ThinkingLevel` (`src/policy/effort.ts`) | new | `"off" \| "minimal" \| "low" \| "medium" \| "high" \| "xhigh" \| "max"`; `THINKING_LADDER: readonly ThinkingLevel[]` in that order | no |
| `ModelThinking` (`src/policy/effort.ts`) | new | `{ reasoning: boolean; thinkingLevelMap?: Partial<Record<ThinkingLevel, string \| null>> }`, the subset of pi-ai `Model` the clamp reads | no |
| `supportedLevels(model: ModelThinking): ThinkingLevel[]` | new | `src/policy/effort.ts` | no |
| `clampLevel(model: ModelThinking, level: ThinkingLevel): ThinkingLevel` | new | `src/policy/effort.ts` | no |
| `ForkedLaunch` (`src/policy/route.ts`) | new | `"untouched" \| "thinking"` | no |
| `LaunchKind` | new | `{ kind: "untouched"; locked: boolean } \| { kind: "ask"; tierQuestion: boolean; locked: boolean }` | no |
| `launchKind(launch: EffectiveLaunch, offered: readonly TierName[], forkedLaunch: ForkedLaunch): LaunchKind` | new | `src/policy/route.ts`. `tierQuestion` is false for thinking-only launches (forked `thinking`, or `offered` empty) and for model-locked launches is still true | no |
| `RouteInput` | new | `{ answers: WorkerAnswers \| undefined; launch: EffectiveLaunch; offered: readonly TierName[]; forkedLaunch: ForkedLaunch; canRun: (t: TierName) => boolean; thinkingOf: (t: TierName) => ModelThinking \| undefined; modelOf: (t: TierName) => string }` | no |
| `Route` | new | `{ kind: "untouched"; locked?: true } \| { kind: "skip" } \| { kind: "routed"; write: { model?: string; thinking?: ThinkingLevel }; record: { reason: WorkerReason; tier?: TierName; fallback?: TierName; effort?: ThinkingLevel; locked?: true } }`. `WorkerReason` = `TierDecision` reasons plus `"untouched" \| "miss"` | no |
| `routeLaunch(input: RouteInput): Route` | new | `src/policy/route.ts`. Calls `launchKind` first; `answers` `undefined` means no request was sent and is valid only for an `untouched` launch (otherwise the route is `skip`) | no |
| `registerWorkerRouting(pi: ExtensionAPI, deps?: WorkerDeps): WorkerRouting` | new | `src/host/worker.ts`. `WorkerRouting = { off(): void; clearWarnings(): void; pending(): number }`; `pending()` counts drafts and buffered outcomes, for tests. `WorkerDeps = { ask?: typeof askJev; append?: (entry: unknown) => void; snapshot?: () => Snapshot; agentDir?: string; now?: () => number }`; defaults are the real `askJev`, `appendLedger(jevDir(), …)`, `loadSnapshot(pi)`, `getAgentDir()` and `Date.now` | no |
| `ScriptEntry.reply` (`tests/host/fixture.ts`) | modified | `FixtureReply \| ((req: RecordedRequest) => FixtureReply)`; existing static replies unchanged | no |
| `fixtureModelsJson(baseUrl, opts?: { keyless?: boolean })` (`tests/host/fixture.ts`) | modified | With `keyless`, adds provider `fixture2` (same `baseUrl` and `api`, no `apiKey`) with model `fixture-deep`; the `fixture` provider is unchanged | no |

No CLI argument, state file or ledger format changes.

---

## Task 1: `subagents.forkedLaunch` setting — implements 1.1

**Files:**
- Modify: `src/store/config.ts`, `src/store/defaults.ts`, `src/store/settings.ts`.
- Test: `tests/store/config-read.test.ts`, `tests/store/settings.test.ts`. `tests/store/config-write.test.ts` must still pass (the slot writer keeps unknown-to-it keys such as `subagents`).

**Interfaces:** Produces `Config.subagents`, `DEFAULTS.subagents`, `Settings.subagents` (see Contracts).

- [ ] **Step 1: Write failing tests**, named after the scenarios:
  - "Forked launch setting accepted": `{"subagents":{"forkedLaunch":"thinking"}}` reads valid with that value.
  - "Forked launch setting rejected": `"skip"` gives an issue at `subagents.forkedLaunch`; `{"subagents":{"inheritContext":"skip"}}` gives an issue at `subagents.inheritContext`.
  - "Everything defaulted" is extended: `settings.subagents.forkedLaunch === "untouched"`.
  - "Forked launch from config": config `thinking` gives `thinking`.
- [ ] **Step 2: Run** `bun test tests/store/config-read.test.ts tests/store/settings.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Add `subagents: object({ forkedLaunch: oneOf(["untouched", "thinking"] as const) })` to `configValidator`, the default, and the resolver line `subagents: { forkedLaunch: config.subagents?.forkedLaunch ?? DEFAULTS.subagents.forkedLaunch }`.
- [ ] **Step 4: Run** the tests, then `bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(store): subagents.forkedLaunch setting`.

## Task 2: Thinking clamp — implements 2.1

**Files:**
- Modify: `src/policy/effort.ts`.
- Test: `tests/policy/effort.test.ts`, `tests/policy/clamp-parity.test.ts`.

**Interfaces:** Produces `ThinkingLevel`, `THINKING_LADDER`, `ModelThinking`, `supportedLevels`, `clampLevel`.

- [ ] **Step 1: Write failing tests** in `tests/policy/effort.test.ts`, one per scenario of "Supported thinking levels" and "Thinking clamp":
  - `supportedLevels({reasoning:false})` is `["off"]`.
  - `supportedLevels({reasoning:true})` is `["off","minimal","low","medium","high"]`.
  - `clampLevel({reasoning:true}, "high")` is `high`.
  - `clampLevel({reasoning:true}, "xhigh")` is `high`.
  - `clampLevel({reasoning:true, thinkingLevelMap:{xhigh:"x"}}, "xhigh")` is `xhigh`.
  - `clampLevel({reasoning:true, thinkingLevelMap:{low:null}}, "low")` is `medium`.
  - `clampLevel({reasoning:false}, "high")` is `off`.
- [ ] **Step 2: Write the parity test** "Parity with Pi" in `tests/policy/clamp-parity.test.ts`:
  - Import `clampThinkingLevel` and `getSupportedThinkingLevels` from `@earendil-works/pi-ai`. Lint rules do not cover `tests/`, so no override is needed.
  - Shapes:
    - `{reasoning:false}`;
    - `{reasoning:true}`;
    - `{reasoning:true, thinkingLevelMap:{xhigh:"x"}}`;
    - `{reasoning:true, thinkingLevelMap:{xhigh:"x", max:"m"}}`;
    - `{reasoning:true, thinkingLevelMap:{minimal:null, low:null}}`;
    - `{reasoning:true, thinkingLevelMap:{off:null}}`.
  - Each shape is cast to pi-ai's `Model` with only the fields the functions read.
  - For every shape and every level of `THINKING_LADDER`, assert `clampLevel` equals `clampThinkingLevel` and `supportedLevels` equals `getSupportedThinkingLevels`.
- [ ] **Step 3: Run** `bun test tests/policy/effort.test.ts tests/policy/clamp-parity.test.ts`. Expect FAIL (not exported).
- [ ] **Step 4: Implement** both functions with the pi-ai algorithm:
  - `supportedLevels`: `["off"]` without reasoning. Otherwise filter the ladder, dropping a level mapped to `null`, and keeping `xhigh` and `max` only when their map entry is defined.
  - `clampLevel`: return the level if supported. Else search upward from the requested index, then downward, then fall back to the first supported level.
- [ ] **Step 5: Run** the tests, then `bun run lint`. Expect PASS, no boundary error.
- [ ] **Step 6: Commit** `feat(policy): thinking clamp mirroring Pi`.

## Task 3: Launch route — implements 2.2

**Files:**
- Create: `src/policy/route.ts`.
- Test: `tests/policy/route.test.ts`.

**Interfaces:**
- Consumes `decideTier`, `chooseFallback` (`tier.ts`), `workerEffort`, `clampLevel`, `ModelThinking` (Task 2), `EffectiveLaunch`, `TierName` (`launch.ts`), `WorkerAnswers` (`worker.ts`).
- Produces `ForkedLaunch`, `LaunchKind`, `launchKind`, `RouteInput`, `Route`, `routeLaunch`.

- [ ] **Step 1: Write failing table tests**, one `test` per scenario of these requirements: "Route result", "Launches left untouched", "Route on Jev failure", "Route writes thinking only", "Routed launch", "Nothing can run", "Locks in the route".
  - Helpers:
    - `launch(overrides)` gives an `EffectiveLaunch` with all fields false.
    - `read({tier?, effort?, risky?, expertNeeded?})` builds `WorkerAnswers`.
    - `input(overrides)` uses default `offered` of all four tiers except `expert`, `forkedLaunch` `untouched`, `canRun` always true, `thinkingOf` returning `{reasoning:true}`, and `modelOf(t)` returning `` `fx/${t}` ``.
  - Expected values come from the scenarios:
    - "Cascade with xhigh": `canRun` false for `deep`, and `thinkingOf("balanced")` gives `{reasoning:true}`. Expect `write` = `{model:"fx/balanced", thinking:"high"}` and `record` = `{reason:"choice", tier:"balanced", fallback:"deep", effort:"high"}`. Here `xhigh` is clamped to `high`.
    - "Expert never a cascade target": the decided tier is `deep` by `risky` .9, `canRun` is true only for `expert`, and `offered` includes `expert`. Expect `write` = `{}` and `record` = `{reason:"risky", tier:"deep", fallback:"deep"}`.
    - "Model locked": `launch({modelLocked:true})`, `tier` `fast`/.9, effort `high`. Expect `write` = `{thinking:"high"}` and `record` = `{reason:"choice", tier:"fast", effort:"high", locked:true}`. There is no `fast` cap because the model is not routed.
  - `launchKind` tests:
    - resume gives `untouched`;
    - forked + `untouched` gives `untouched`;
    - both locked gives `untouched` with `locked: true`;
    - forked + `thinking` + thinking locked gives `untouched`;
    - forked + `thinking` gives `ask` with `tierQuestion: false`;
    - `offered` empty gives `tierQuestion: false`;
    - otherwise `tierQuestion: true`.
- [ ] **Step 2: Run** `bun test tests/policy/route.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `launchKind`, then `routeLaunch` in the order of design §1:
  - Call `launchKind` first.
  - `cancelled` gives `skip`.
  - `miss` gives `routed` with reason `miss`.
  - Thinking-only branch: `workerEffort({ effort, risky, movedByFallback: false })` with no tier. Thinking is unclamped. Reason is `untouched`, or the decided tier and reason when model-locked.
  - Otherwise: `decideTier`, then `chooseFallback(tier, offered, canRun)`, then `workerEffort` with `tier` and `movedByFallback`, then `clampLevel(thinkingOf(final) ?? {reasoning:true}, effort)`.
  - A thinking lock drops `write.thinking` and `record.effort`.
  - `unchanged` records `fallback: decided`.
  - `locked: true` is set when either field is locked.
  - `Route` reasons are declared in `route.ts`. In `tests/policy/route.test.ts`, add a type-level subset check `const _ok: (r: RouteReason) => WorkerReason = (r) => r;` (`WorkerReason` from `src/store/ledger-schema.ts`; `bun run typecheck` covers `tests/`), and a runtime test "Recorded results validate": for one `routed` result per reason, build a minimal worker line from `record` and assert `validateLedgerEntry` accepts it. This pins that deciding reasons carry `tier`.
- [ ] **Step 4: Run** the test, then `bun run lint`. Expect PASS.
- [ ] **Step 5: Commit** `feat(policy): worker launch route`.

## Task 4: Host routing — implements 3.1, 3.2, 3.3

Warnings (3.3) share the `tool_call` code path with the target check, so they stay in this task; the commit message lists all three IDs.

**Files:**
- Create: `src/host/worker.ts`.
- Test: `tests/host/worker.test.ts`. This is a unit test with fake `pi`, `ctx` and `ask`; there is no Pi process.

**Interfaces:**
- Consumes:
  - `routeLaunch`, `launchKind` (Task 3);
  - `readAgent` (`host/agents.ts`);
  - `effectiveLaunch` (`policy/launch.ts`);
  - `buildWorkerState` (`jev/state.ts`);
  - `offeredTiers`, `buildWorkerQuestions` (`jev/questions.ts`);
  - `readWorkerOutcome` (`policy/worker.ts`);
  - `askJev` (`jev/client.ts`);
  - `loadSnapshot` (`host/readiness.ts`);
  - `isChild` (`host/child.ts`);
  - `Settings` (Task 1).
- Produces `registerWorkerRouting` (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/host/worker.test.ts`.
  - Harness:
    - A fake `pi` records `on(event, handler)` and gives `events.on`.
    - `loadSnapshot` is injected: add `snapshot?: () => Snapshot` to `WorkerDeps`, defaulting to `() => loadSnapshot(pi)`.
    - A fake `ctx` has `sessionManager.getSessionId()`, `getBranch()`, `cwd`, `signal`, `hasUI`, `ui.notify`, and `modelRegistry.find` / `hasConfiguredAuth` backed by a map.
    - The fake `ask` records each request and returns a scripted `JevOutcome`. Answer bodies use the shape `readAnswers` accepts (`{ answers: { tier: { choice, probabilities }, effort: {...}, risky: { noul } } }`, see `tests/policy/answers.test.ts`).
  - One `test` per scenario of "When routing runs", "Sibling launches classified together", "Launches without a cached result", "Worker request content", "Target check before writing", "Input mutation" and "Routing fails open" whose behaviour is visible without a child process. Examples:
    - "Switch off": snapshot with `switches.subagents` false. `ask` is never called and the input is deep-equal to before.
    - "Two launches": a `message_end` with two `subagent` tool calls. `ask` is called twice before either `tool_call` handler runs. Each `tool_call` gets its own decision.
    - "Nested launch": a `tool_call` with `parentToolCallId` and no prior `message_end`. `ask` is called once, with the request built from that input.
    - "Display name prefix": registry model `name` `Fixture Fast`. The request's `questions.tier.criteria.fast` starts with `Fixture Fast. `.
    - "Missing credentials", "Unknown model": `canRun` false for `deep`. The input is routed to `balanced`.
    - "Turn cancelled": `ask` returns `cancelled`. The input is unchanged and no draft exists.
    - "Internal error": the injected `ask` throws synchronously. The input is unchanged and the `tool_call` handler resolves without throwing.
  - Review Focus tests:
    - "Model id with a slash": `tiers.fast` `openrouter/anthropic/claude` is looked up as `find("openrouter", "anthropic/claude")`.
    - "Cancelled batch not re-asked": `message_end` `ask` returns `cancelled`. At `tool_call`, `ask` is not called again.
  - Warning tests, one per scenario of "Fallback warning":
    - "Warning text": assert `notify` gets one call of type `warning`. Its text contains `tier deep`, the model, `no credentials`, `using balanced` and `tiers.deep`.
    - "Once per tier", "Shown again after a model change", and "Shown again after /jev" (via `clearWarnings()`; the `/jev` wiring is tested in Task 6).
    - "Nothing can run": the text contains `launch left unchanged`.
    - "Unknown model wording".
    - "No UI": `hasUI` false gives no `notify`, and the input is still routed.
- [ ] **Step 2: Run** `bun test tests/host/worker.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** `registerWorkerRouting` per design §5 and §6.
  - **Gate:** `snapshot().config.valid && keySet && executor && settings.switches.subagents && !isChild(sessionId)`.
  - **Offered tiers:** `offeredTiers(settings.tiers, settings.switches.expert)`.
  - **Parent request:** when `settings.state.parentRequest` is set, it is the text of the last `user` message entry on `ctx.sessionManager.getBranch()`.
  - **Cache:** a `Map` keyed by `toolCallId`, holding `{ facts, launch, kind, outcome: Promise<JevOutcome> | undefined, specs }`. It keeps at most 256 entries, deleting the oldest on insert.
  - **Warning text:**

    ```text
    Jev: tier ${tier} (${model}) cannot run (${why}); using ${to}. Fix tiers.${tier} in ${join(jevDir(), "config.json")}.
    ```

    The no-target variant ends with `; launch left unchanged. Fix …`.
  - **Dedupe:** a `Set` of `${tier}\u0000${model}`.
  - **Errors:** every handler body is wrapped in `try { … } catch { /* fail open */ }`. Compute both `model` and `thinking` before assigning either to `event.input`, then assign them together, so an error never leaves a half-written input.
  - **`message_end`:** act only on `role === "assistant"` messages; take `content` blocks with `type === "toolCall"` and `name === "subagent"`, using `id` and `arguments`.
  - **Parent request text:** the last `message` entry with role `user` on the branch; string content as-is, array content as its `text` parts joined with `\n`; omitted when empty.
  - **Agent lookup:** `readAgent(input.subagent_type, { cwd: ctx.cwd, agentDir: deps.agentDir ?? getAgentDir() })`.
  - **Untouched launches:** when `launchKind` is `untouched`, call `routeLaunch` with `answers: undefined` and send nothing.
- [ ] **Step 4: Run** the test, then `bun run typecheck` and `bun run lint`. Expect PASS.
- [ ] **Step 5: Commit** `feat(host): route worker launches (3.1, 3.2, 3.3)`.

## Task 5: Ledger join — implements 4.1

**Files:**
- Modify: `src/host/worker.ts`.
- Test: `tests/host/worker-ledger.test.ts`.

**Interfaces:**
- Consumes `appendLedger` (`store/ledger.ts`) through `WorkerDeps.append`.
- Uses `pi.events.on("subagents:completed" | "subagents:failed" | "subagents:resumed")`.

- [ ] **Step 1: Write failing tests**, one per scenario of "One line per launch", "Outcome joined from the executor", "Decision fields", "Caller model field" and "Ledger failures do not affect the launch". Drive them through the fake `pi` from Task 4: `tool_call`, then `tool_result` with `details.agentId`, then emit `subagents:completed` `{ id, status, toolUses, durationMs, tokens: { total } }`.
  - **Join and outcome:**
    - "Foreground completion": the event is emitted *before* the `tool_result`. One line is written with `status` `completed` and `toolUses` 3.
    - "Background completion": the event comes after the tool result. One line is written.
    - "Refused launch": the `tool_result` has no `details`. One line is written with `status` `error`.
  - **Recorded fields:**
    - "Routed fields": `tier`, `reason`, `model`, `effort`, `callerModel`, `mode` `standard`, `answered` true, `ms`, `briefChars`, `agent`.
    - "Untouched recorded": resume, then `subagents:resumed`. The line has `reason` `untouched`, `answered` false, and no `ms` or `tier`.
    - "Miss recorded": `miss` `timeout`, `answered` false.
  - **Caller model and locks:**
    - "Caller model outside the rule": `model: "a b"` gives no `callerModel`.
    - "No caller model".
    - "Not locked": the line has no `locked` key.
  - **No line written:**
    - "Agent name outside the ledger rule": agent `my agent!` gives no line, and the input is still routed. A second case: `append` throws, and the handlers still resolve.
    - Every other scenario of the five requirements gets its own `test`, named as in the Scenario → test table.
    - "Not running means no line": with the switch off, an emitted completion writes nothing.
  - **Review Focus:**
    - "Unknown agent id ignored": a `subagents:completed` for an id never seen writes nothing and does not throw.
    - "Two launches, two lines": two siblings with the same `subagent_type` and different agent ids give two lines, each with its own decision.
    - "Drafts are bounded": 300 `tool_call`s without results leave `pending()` at most 256.
- [ ] **Step 2: Run** `bun test tests/host/worker-ledger.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the join per design §5 and §8.
  - **Draft:** built at `tool_call`.
  - **Pairing:** `byCall` maps `toolCallId` to the draft. `byAgent` maps `agentId` to the draft. `outcomes` maps `agentId` to the event payload. The write happens when both a draft and an outcome are present for an agent id.
  - **Line fields:**
    - `v: 1`, `at: now()`, `kind: "worker"`, `session`.
    - `briefChars` is `Array.from(prompt).length`.
    - `tierP` is `tier.probabilities` when answered. `effortP` likewise.
    - `callerModel` is set only when it matches `^[A-Za-z0-9._:/-]{1,128}$`.
    - `tokens` is `payload.tokens?.total`.
    - `status` is `payload.status`.
  - **Limits:** all maps are bounded at 256 entries and cleared in `off()`.
  - **Absent answers:** any field whose source is absent (no request, or a question not asked or not answered) is omitted. A thinking-only line records `risky` when answered, and never `expertNeeded` or `tierP`.
  - **Field sources** (design §8): `mode` is `settings.mode`; `answered` is true only for an `ok` outcome; `ms` from the outcome when it has one; `miss` is `outcome.miss`; `risky` and `expertNeeded` are the `noul` answers from `WorkerAnswers`; `tierP` and `effortP` are the choice probabilities; `agent` is `facts.name`; `tier`, `reason`, `fallback`, `model`, `effort`, `locked` come from `Route.record` and `write.model`; `status`, `durationMs`, `toolUses` and `tokens` (`tokens?.total`) from the executor payload.
  - **Append:** call `deps.append` inside `try`; a throw is swallowed.
- [ ] **Step 4: Run** the test. Expect PASS.
- [ ] **Step 5: Commit** `feat(host): worker ledger lines`.

## Task 6: Wiring — implements 3.4

**Files:**
- Modify: `src/host/setup.ts`. After `subscribeChildren`, it calls `const routing = registerWorkerRouting(pi)`; registration must not touch `ctx` or `loadSnapshot`. `routing.off()` is called in the `session_shutdown` handler inside its own `try`, so a throwing child unsubscribe does not skip it. The `/jev` handler calls `routing.clearWarnings()` before `runJev`.
- Modify: `tests/host/setup.test.ts`.

**Interfaces:** Consumes `registerWorkerRouting` and `WorkerRouting` (Tasks 4 and 5).

- [ ] **Step 1: Update `tests/host/setup.test.ts` so it fails.** In "subscribes to both child events before any handler is registered":
  - Keep `order.slice(0, 2)` as the two child events, since routing registers after them.
  - The expected handler keys become `before_agent_start`, `message_end`, `session_shutdown`, `session_start`, `tool_call`, `tool_result`.
  - Any count of live bus subscriptions becomes 2 + 3 (`subagents:completed`, `subagents:failed`, `subagents:resumed`).
  - Add "session_shutdown removes routing subscriptions": after shutdown, no live subscriptions remain.
  - Add "/jev clears shown warnings": with the existing temp `agentDir` from `beforeEach`, write a valid `config.json` with an unusable `tiers.deep`, set the key env, point `classifier.url` at a loopback `startJevFixture` answering `deep` .9, and drive a `tool_call` through the registered handlers with a fake ctx whose registry lacks the `deep` model. One warning; a second `tool_call` adds none; running the registered `jev` handler (`/jev` with no args) then a third `tool_call` shows it again.
  - Add "shutdown unsubscribes routing even when the child unsubscribe throws" next to the existing `throwOnOff` test.
- [ ] **Step 2: Run** `bun test tests/host/setup.test.ts`. Expect FAIL.
- [ ] **Step 3: Wire** `setup.ts` as listed above.
- [ ] **Step 4: Run** `bun test tests/host/setup.test.ts && bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(host): wire worker routing`.

## Task 7: Host tests — implements 5.1, 5.2, 5.3

**Files:**
- Create: `tests/host/worker-routing.test.ts`.
- Create: the probe `tests/host/probes/nested/`, with `package.json` modelled on `probes/rewrite` and an `index.ts`.
- Modify: `tests/host/fixture.ts`, where `ScriptEntry.reply` may be a function and `fixtureModelsJson` gains `keyless`. See Contracts.
- Modify: `tests/host/harness.ts`, adding a `keyless` passthrough to `prepare`. Keep `tests/host/fixture.test.ts` green.

**Interfaces:**
- Consumes the wired package (Task 6).
- Uses `startHostSession({ self: true, executor: true, probes, agents, env, timeoutMs })`, `startFixture`, and `startJevFixture` (`tests/jev/fixture.ts`).

- [ ] **Step 1: Extend the fixtures.**
  - `reply` accepts `(req) => FixtureReply`.
  - `fixtureModelsJson(baseUrl, { keyless: true })` adds provider `fixture2`: same `baseUrl` and `api`, no `apiKey`, model `fixture-deep`, `reasoning: true`.
  - Run `bun test tests/host/fixture.test.ts`. Expect PASS.
  - Smoke the keyless provider: start one host session with `keyless` and prompt once (an existing `jev-base` style reply). Pi must start. If Pi rejects a provider without `apiKey`, give `fixture2` `apiKey: "$JEV_UNSET_KEY"` (an env var that is never set) instead, and record this in the apply notes.
- [ ] **Step 2: Add the probe** `tests/host/probes/nested/index.ts`. It registers tool `nest`:
  - parameters: a TypeBox object `{ args: Type.Record(Type.String(), Type.Unknown()) }`, importing `Type` from `typebox` as `src/host/review.ts` does (Pi aliases it for extensions; if the installed probe cannot resolve it, use a plain JSON-schema object and record the deviation);
  - default (direct) exposure, so `executeTool("subagent", …)` is allowed;
  - `execute(id, params, signal, onUpdate, ctx)` returns the text of `await ctx.executeTool("subagent", params.args)`;
  - it reports each `tool_call` for `subagent` with `parentToolCallId` through `probeReport("nested")`.
- [ ] **Step 3: Add a test helper** `writeJev(agentDir, { config, state? })`. It creates `<agentDir>/jev/` and writes `config.json`, plus `state.json` when given. Call it after `startHostSession` and before the first `prompt`. Routing reads the files fresh, so no restart is needed.
  - `config` sets `classifier.url` to the Jev fixture URL and `classifier.timeoutMs` to `1500`, or `300` in the timeout test.
  - It sets tiers `fast: fixture/fixture-fast` and `balanced: fixture/fixture-balanced`, and in the cascade test also `deep: fixture2/fixture-deep`.
  - The env sets `TYPESAFE_API_KEY=test-key`.
  - Jev replies use the `readAnswers` body shape.
- [ ] **Step 4: Write the host tests.** The child is identified by `CHILD-TASK`, as in `q1-q7-worker-mutation.test.ts`.
  - "Caller model replaced":
    - Jev answers `tier` `fast` .9 and `effort` `medium`.
    - The child request has model `fixture-fast` and `reasoning_effort` `medium`.
    - The ledger (`readLedger(<agentDir>/jev)`) has one worker line with `tier` `fast`, `status` `completed` and `callerModel` `fixture/fixture-main`.
  - "Background launch": the same with `run_in_background: true`. Wait for the ledger line.
  - "Resume untouched":
    - Script order: the `RESUME-TASK` child entry is listed before the generic `CHILD-TASK` child entry, because the resumed session's history still contains `CHILD-TASK`.
    - First reply: a `subagent` call.
    - Second main reply: a function reply that reads the agent id from the previous `tool` message text with `/Agent ID: (\S+)/` and calls `subagent` with `resume: <id>` and prompt `RESUME-TASK`.
    - The resumed child request (matched by `RESUME-TASK`) uses the model the first launch was routed to; resume does not change it.
    - The second ledger line has `reason` `untouched`.
    - The Jev fixture received exactly one request.
  - "Forked launch left alone" and "Forked launch with thinking":
    - Both launch with `inherit_context: true`.
    - With `untouched`: the child model and effort are the caller's (`fixture-balanced`, `low`), and Jev gets no request.
    - With `thinking`: the child model is the caller's and `reasoning_effort` is routed. The Jev request's question keys are exactly `effort` and `risky`.
  - "Jev timeout" (the fixture route `hang`) and "Jev error" (status 500):
    - The child uses the caller's model and thinking.
    - The ledger line has `miss` `timeout` or `error`.
  - "Switch off" (`state.json` `switches.subagents` false) and "No key" (env without the key): the Jev fixture receives zero requests.
  - "Once per tier":
    - Use `keyless` models with `deep: fixture2/fixture-deep`. Jev answers `deep` .9 for two sibling launches.
    - Both children use `fixture-balanced`.
    - Exactly one `extension_ui_request` with `method` `notify` and type `warning` contains `tiers.deep`.
    - Both ledger lines have `fallback` `deep`.
    - "No prompt text": no file under `<agentDir>/jev/` contains the brief marker.
  - "Nested launch":
    - The main model calls `nest` with `args` for a `subagent` launch.
    - The Jev fixture receives one request.
    - The probe recorded a `tool_call` with `parentToolCallId`.
    - The child runs on the routed model.
- [ ] **Step 5: Run** `bun test tests/host/worker-routing.test.ts`. Expect PASS. Run it three times to check for flakiness. On failure, debug against the real CLI, not by weakening assertions.
- [ ] **Step 6: Commit** `test(host): worker routing end to end`.

## Task 8: Docs and release check — implements 6.1, 6.2, 6.3

**Files:**
- Modify: `docs/domain-model.md`, `docs/jev-contract.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/roadmap.md`.
- Create: `/tmp/wg11/issue-14-body.md` (outside the repository).

- [ ] **Step 1: Update docs.**
  - `domain-model.md` §WorkerDecision: the forked-launch rule follows `subagents.forkedLaunch`; thinking-only and model-locked behaviour; the ledger `reason` describes the model decision.
  - `jev-contract.md` §Eligibility: forked launches with `thinking` ask only `effort` and `risky`.
  - `usage-guide.md`, troubleshooting row: name `subagents.forkedLaunch`.
  - `workflow.md`, the worker sequence:
    - `resume`, or forked with `untouched`, leads to unchanged;
    - forked with `thinking` gets thinking only;
    - nested launches are classified at `tool_call`;
    - the outcome comes from `subagents:completed`, `subagents:failed` or `subagents:resumed`.
  - `configuration.md`: the `subagents` section and the full example.
  - `architecture.md`: `policy/route.ts` and `host/worker.ts` in the module layout.
  - `roadmap.md`: WG-11 status `Done`; WG-13 scope without the tier cascade.
- [ ] **Step 2: Draft** `/tmp/wg11/issue-14-body.md`. Start from `/tmp/wg11/issue-14-current.md` (the current #14 body, saved by the parent), with the "pre-launch cascade for tiers and slots" item reduced to slots. The parent shows it to the operator; nothing is posted by the implementer.
- [ ] **Step 3: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expect all pass.
- [ ] **Step 4: Commit** `docs: worker routing host wiring`.

---

## Scenario → test

**config-file**
- Duplicate hold provider, Hold provider bounds, Non-boolean parentRequest, Enum values → existing tests in `tests/store/config-read.test.ts` (unchanged)
- Forked launch setting accepted, Forked launch setting rejected → `tests/store/config-read.test.ts` (Task 1)

**settings-resolution**
- Everything defaulted, Forked launch from config → `tests/store/settings.test.ts` (Task 1)
- Config over default, Tuning over config → existing tests in `tests/store/settings.test.ts` (unchanged)

**worker-decision**
- Non-reasoning levels, Default reasoning levels, Supported level kept, Ceiling without a map entry, Mapped xhigh, Level disabled in the map, Non-reasoning model → `tests/policy/effort.test.ts` (Task 2)
- Parity with Pi → `tests/policy/clamp-parity.test.ts` (Task 2)
- Locked flag, Locked untouched launch, No lock, Resume, Forked launch left alone, Both fields locked, Forked thinking with thinking locked, Cancelled, Miss, Forked launch with thinking, No tier offered, No tier decided, No effort answer, No tier decided with thinking locked, Chosen tier written, Clamped to the model, Cascade with xhigh, All lower tiers unusable, Expert never a cascade target, Model locked, Model locked without a decided tier, Thinking locked → `tests/policy/route.test.ts` (Task 3)

**worker-routing**
- Switch off, No key, Invalid config, Executor absent, Child session, Nested launch with the switch off, Other tools ignored → `tests/host/worker.test.ts` (Task 4); Switch off and No key also in `tests/host/worker-routing.test.ts` (Task 7)
- Two launches, Untouched launch not asked → `tests/host/worker.test.ts` (Task 4)
- Nested launch → `tests/host/worker.test.ts` (Task 4) and `tests/host/worker-routing.test.ts` (Task 7)
- Nested launch with Jev down → `tests/host/worker.test.ts` (Task 4)
- Display name prefix, Parent request off → `tests/host/worker.test.ts` (Task 4)
- Forked launch with thinking asks fewer questions → `tests/host/worker.test.ts` (Task 4) and `tests/host/worker-routing.test.ts` (Task 7)
- Unknown model, Missing credentials, Model-locked launch not checked → `tests/host/worker.test.ts` (Task 4)
- Caller model replaced, Background launch, Resume untouched → `tests/host/worker-routing.test.ts` (Task 7)
- Warning text, Nothing can run, Unknown model wording, Shown again after a model change, No UI → `tests/host/worker.test.ts` (Task 4)
- Shown again after /jev → `tests/host/worker.test.ts` (Task 4) and the `/jev` wiring test in `tests/host/setup.test.ts` (Task 6)
- Once per tier → `tests/host/worker.test.ts` (Task 4) and `tests/host/worker-routing.test.ts` (Task 7)
- Unreadable answers, Turn cancelled, Internal error → `tests/host/worker.test.ts` (Task 4)
- Jev timeout, Jev error → `tests/host/worker.test.ts` (Task 4) and `tests/host/worker-routing.test.ts` (Task 7)

**worker-ledger**
- Routed launch recorded, Foreground completion, Background completion, Failed worker, Refused launch → `tests/host/worker-ledger.test.ts` (Task 5)
- Routed fields, Fallback recorded, Nothing could run recorded, Thinking-only recorded, Miss recorded, Untouched recorded, Locked recorded, Not locked → `tests/host/worker-ledger.test.ts` (Task 5)
- Not running means no line, Cancelled turn → `tests/host/worker-ledger.test.ts` (Task 5)
- Caller model outside the rule, No caller model, Agent name outside the ledger rule → `tests/host/worker-ledger.test.ts` (Task 5)
- No prompt text → `tests/host/worker-ledger.test.ts` (Task 5) and `tests/host/worker-routing.test.ts` (Task 7)
