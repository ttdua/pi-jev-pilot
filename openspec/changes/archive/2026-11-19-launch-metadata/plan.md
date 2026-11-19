# Launch Metadata Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`specs/launch-metadata/spec.md`, `specs/executor-launch-policy/spec.md`) and `design.md`.

**Goal:** Service launches carry opaque, validated, frozen caller metadata on every child event, record event, record snapshot and launch request. `SubagentsService.childSession()` maps a live child session id to its launch.

**Architecture:** Two new pure seams in the vendored executor:
- `launch-metadata.ts` validates and freezes the map;
- `child-sessions.ts` is the process-wide registry.

Metadata travels on the `Subagent` record next to `origin` and `parentSession`. The launch identity spread (`launchIdentity`) puts it on the child events, and an observer helper puts it on the record events. The child lifecycle publisher keeps the registry in step with `session-created`/`disposed`.

**Tech Stack:** TypeScript, vitest (vendored package), Bun at the root; all work under `packages/pi-subagents/`.

## Global Constraints

- **Limits:**
  - at most 32 keys;
  - keys match `^[a-z][a-z0-9_.-]{0,63}$`;
  - values are strings with `length` ≤ 1024;
  - the map is a plain object (prototype `Object.prototype` or `null`).
- **Absence:** an empty map counts as no metadata. Absent metadata is omitted from events, snapshots and `LaunchRequest`. `childSession().metadata` is always present, `{}` frozen when there is none.
- **Additive only:** every new field is optional; no existing field changes name, type or meaning (`executor-launch-identity` "Identity fields are additive").
- **Fail early:** a refusal throws synchronously from `spawn()` before anything is created. Nothing is truncated or coerced.
- **Not persisted:** the `subagents:record` entry (`src/persisted-record.ts`) is not changed.
- **Registry key:** `Symbol.for("@ttdua/pi-subagents:child-sessions")`.
- **Vendored-tree rules:** every edited upstream file gets a `VENDORED.md` row. jev-pilot's own lint, typecheck and import-graph checks do not cover `packages/`.
- **Tests:** no secrets, no paid calls, no network beyond loopback.

## Review Focus

- **Frozen metadata reused across events:** writing to an event's `metadata` must not reach the record, the registry or a later event. Pinned in Task 2 (`consumer cannot write`).
- **Inherited and symbol keys:**
  - a caller object built with `Object.create({ x: "1" })` has a non-plain prototype and must be refused;
  - an object with any own symbol key is not a plain string map and must be refused, not silently ignored.
  - Pinned in Task 1 (`refuses symbol keys`).
- **`__proto__` as a key:** `{"__proto__": "x"}` parsed from JSON is an own key that fails the key pattern (leading `_`) and must be refused, not set as the prototype of the copy. Pinned in Task 1.
- **Registry entry for a child whose bind throws:** `dispose()` runs, so the entry is removed. Pinned in Task 2 (`failed bind`).
- **Two executor instances (main and child) in one process:** both must see one registry. Pinned in Task 1 (`shares entries across module instances`) and Task 2 (`Shared across executor instances`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `LaunchMetadata` | new | `type LaunchMetadata = Readonly<Record<string, string>>` (exported from `src/service/service.ts`) | yes |
| `SpawnOptions.metadata` | modified | `metadata?: LaunchMetadata` | yes |
| `SubagentRecord.metadata` | modified | `metadata?: LaunchMetadata`; present only when the launch has metadata | yes |
| `LaunchRequest.metadata` | modified | `metadata?: LaunchMetadata`; present only when the launch has metadata | yes |
| `ChildSessionInfo` | new | `interface ChildSessionInfo { readonly agentId: string; readonly agentType: string; readonly metadata: LaunchMetadata }` | yes |
| `SubagentsService.childSession` | modified (new method) | `childSession(sessionId: string): ChildSessionInfo \| undefined` | yes |
| `PublishedLaunchIdentity` | modified | adds `metadata?: LaunchMetadata`. So `ChildSpawningEvent`, `ChildSessionCreatedEvent` and `ChildBoundEvent` gain it | yes (event payload types) |
| `LaunchSource` / `LaunchIdentity` (`src/seams/identity.ts`) | modified | both add `metadata?: LaunchMetadata`; `launchIdentity()` copies it when defined | no |
| `launchFields` (`src/seams/identity.ts`) | new | `launchFields(source: LaunchSource): { toolCallId?: string; metadata?: LaunchMetadata }`, replacing `toolCallIdField` at the observer's call sites | no |
| `parseLaunchMetadata` (`src/seams/launch-metadata.ts`) | new | `parseLaunchMetadata(input: unknown): LaunchMetadata \| undefined`, throws `Error` | no |
| `METADATA_LIMITS` (`src/seams/launch-metadata.ts`) | new | `{ maxKeys: 32, keyPattern: /^[a-z][a-z0-9_.-]{0,63}$/, maxValueLength: 1024 }` as const | no |
| child-session registry (`src/seams/child-sessions.ts`) | new | `enterChildSession(sessionId: string, entry: { agentId: string; agentType: string; metadata?: LaunchMetadata }): void`; `leaveChildSession(sessionId: string): void`; `lookupChildSession(sessionId: string): ChildSessionInfo \| undefined`; `resetChildSessions(): void` (tests only) | no |
| `launchIdentity` (`src/seams/identity.ts`) | modified | `launchIdentity(source: LaunchSource): LaunchIdentity`, unchanged signature; the result has `metadata` only when `source.metadata` is defined | no |
| `AgentSpawnConfig.metadata`, `SubagentExecution.metadata`, `CreateSubagentSessionParams.metadata`, `LaunchFacts.metadata`, `LaunchRequestInput.metadata` | modified | `metadata?: LaunchMetadata` each | no |
| `Subagent.metadata` | new | `get metadata(): LaunchMetadata \| undefined`, reads `execution.metadata` | no |
| `dist/public.d.ts` | modified | regenerated; exports the public rows above | yes |

---

## Task 1: Metadata validation and child-session registry seams — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/src/seams/launch-metadata.ts`, `packages/pi-subagents/src/seams/child-sessions.ts`
- Create: `packages/pi-subagents/test/seams/launch-metadata.test.ts`, `packages/pi-subagents/test/seams/child-sessions.test.ts`
- Modify: `packages/pi-subagents/src/service/service.ts` (only to add the `LaunchMetadata` and `ChildSessionInfo` types the seams return; tasks.md 1.3)

**Interfaces:**
- Produces: `parseLaunchMetadata`, `METADATA_LIMITS`, `enterChildSession`, `leaveChildSession`, `lookupChildSession`, `resetChildSessions`, `LaunchMetadata`, `ChildSessionInfo` (see Contracts).

- [ ] **Step 1: Write the failing validation tests** in `test/seams/launch-metadata.test.ts`:
  - `undefined` → `undefined`; `{}` → `undefined`.
  - Accepts 32 keys whose values are 1024-char strings; result deep-equals the input; `Object.isFrozen(result)`; `Object.getPrototypeOf(result) === null`.
  - Copy: mutating the input after parsing leaves the result unchanged.
  - The following each throw. Messages are asserted with `toThrow(/.../)`:

    | Input | Message must match |
    |---|---|
    | 33 keys | `/32/` |
    | `{ Change: "c" }` | `/Change/` and the pattern source |
    | `{ "9a": "x" }` | `/9a/` |
    | a 65-char key | the key |
    | `{ packet: "x".repeat(1025) }` | `/packet/` and `/1024/` |
    | `{ unit: 3 }` | `/unit/` |
    | `[]` | `/plain object/` |
    | `new Map()` | `/plain object/` |
    | `null` | `/plain object/` |
    | `"s"` | `/plain object/` |
    | `Object.create({ x: "1" })` | `/plain object/` |
    | `{ [Symbol("s")]: "x" }` (`refuses symbol keys`) | `/enumerable string keys/` |
    | plain object with a non-enumerable property (`Object.defineProperty`) | `/enumerable string keys/` |
    | `JSON.parse('{"__proto__":"x"}')` | `/__proto__/` |

  - Accepts `Object.create(null)` with valid keys.
  - Accepts `"a.b-c_d"` and a 64-char key.
- [ ] **Step 2: Run, expect failure** — `bun run --cwd packages/pi-subagents test -- test/seams/launch-metadata.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `parseLaunchMetadata(input: unknown): LaunchMetadata | undefined`** in `src/seams/launch-metadata.ts`.
  - Check order: plain object; `Reflect.ownKeys(input).length === Object.keys(input).length` (no symbol or non-enumerable own properties); key count; then each own key in `Object.keys` order (pattern, then value type and length).
  - Copy into `Object.create(null)` and freeze.
  - Messages start with `spawn metadata:`.
- [ ] **Step 4: Run, expect pass** (same command).
- [ ] **Step 5: Write the failing registry tests** in `test/seams/child-sessions.test.ts`, with `afterEach(resetChildSessions)`:
  - Enter then lookup returns `{ agentId, agentType, metadata }`. The entry and its `metadata` are frozen.
  - Without metadata, `metadata` is `{}` and frozen, and is the same object across entries.
  - Unknown id → `undefined`. After `leaveChildSession` → `undefined`.
  - `shares entries across module instances`: after `vi.resetModules()`, a freshly imported `child-sessions` module sees an entry entered by the first import.
- [ ] **Step 6: Run, expect failure**, then implement `src/seams/child-sessions.ts`. The registry is a `Map` stored on `globalThis` under the Contracts key, created lazily. Run again and expect pass.
- [ ] **Step 7: Commit** — `git add packages/pi-subagents/src/seams/launch-metadata.ts packages/pi-subagents/src/seams/child-sessions.ts packages/pi-subagents/src/service/service.ts packages/pi-subagents/test/seams/launch-metadata.test.ts packages/pi-subagents/test/seams/child-sessions.test.ts && git commit -m "feat(executor): add launch metadata validation and child-session registry seams"`

---

## Task 2: Carry metadata through launch, events, record and policy request — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Modify (in `packages/pi-subagents/src/`):
  - `service/service.ts`, `service/service-adapter.ts`
  - `seams/identity.ts`
  - `lifecycle/subagent-manager.ts`, `lifecycle/subagent.ts`, `lifecycle/create-subagent-session.ts`, `lifecycle/child-lifecycle.ts`
  - `seams/launch-gate.ts`, `seams/launch-request.ts`
  - `observation/subagent-events-observer.ts`
- Create: `packages/pi-subagents/test/seams/launch-metadata-flow.test.ts`
- Modify if needed: `packages/pi-subagents/test/service/service-adapter.test.ts`, `packages/pi-subagents/test/seams/launch-policy.test.ts`, `packages/pi-subagents/test/lifecycle/child-lifecycle.test.ts`

**Interfaces:**
- Consumes: `parseLaunchMetadata`, `enterChildSession`, `leaveChildSession`, `lookupChildSession`, `resetChildSessions`, `LaunchMetadata`, `ChildSessionInfo`.
- Produces (public): `SpawnOptions.metadata`, `SubagentRecord.metadata`, `LaunchRequest.metadata`, `SubagentsService.childSession`, `PublishedLaunchIdentity.metadata`.
- Produces (internal): `LaunchSource`/`LaunchIdentity` `metadata`, `launchIdentity`, `launchFields`, `AgentSpawnConfig.metadata`, `SubagentExecution.metadata`, `Subagent.metadata`, `CreateSubagentSessionParams.metadata`, `LaunchFacts.metadata`, `LaunchRequestInput.metadata`.

- [ ] **Step 1: Write the failing flow tests** in `test/seams/launch-metadata-flow.test.ts`.
  - **Harness:** reuse the harness pattern of `test/seams/identity.test.ts`. Add:
    - a `SubagentsServiceAdapter` over the same manager, so `spawn()` is the real service door;
    - the real `createChildLifecyclePublisher`;
    - `afterEach(resetChildSessions)`.
  - **One `it` per spec scenario**, named exactly as in the Scenario → test list below. Each `it` asserts its scenario's THEN values: `{ change: "c1" }`, `call_4`, 33 keys, etc.
  - **Lookup timing:** the "session_start" and "shutdown" lookups are taken inside the fake session's `bindExtensions` mock and inside a `session_shutdown` stub that `emitChildSessionShutdown` invokes.
  - **"Shared across executor instances":** build a second, independent adapter and manager. While the first manager's child is live, call `childSession` on the second adapter.
  - **"Gone after the parent session shuts down":** with a live child, call `manager.abortAll()` and then `await manager.dispose()`, which is what the executor's shutdown handler does on `/reload` and quit. Then call `childSession`.
  - **"Present during event dispatch":** register synchronous subscribers on the harness `emit` for `session-created` and `disposed` that call `childSession(event.sessionId)`.
  - **"Failed grant check":** drive `createSubagentSession` directly with the fixture of `test/seams/grant-check.test.ts` › "a session that cannot drop its grants is disposed, not returned":
    - `tools.grants` is `["web_search"]` for a parent tool that is not a default;
    - faults `registryThrows: true` and `setActiveThrows: Infinity`;
    - replace `createChildLifecycleMock()` with the real `createChildLifecyclePublisher`.
    - Assert that the call rejects, that `disposed` was emitted, and that `childSession` returns `undefined` for the session id `session-created` carried.
  - **"Every surface is frozen":** collect every `metadata` the test can reach and assert `Object.isFrozen` on each.
  - **"Resume takes no metadata":** a type-level test, `expectTypeOf<ResumeOptions>().not.toHaveProperty("metadata")`.
  - **"Persisted entry":** captures `appendEntry`, then reads it back through `readPersistedRuns`.
- [ ] **Step 2: Run, expect failures** — `bun run --cwd packages/pi-subagents test -- test/seams/launch-metadata-flow.test.ts`.
- [ ] **Step 3: Public types** (`service.ts`, `identity.ts`):
  - Add the public Contracts rows to `service.ts`.
  - In `identity.ts`, add `metadata?` to `LaunchSource`, `LaunchIdentity` and `PublishedLaunchIdentity`.
  - `launchIdentity()` copies `metadata` when it is defined.
  - Add `launchFields()` and remove `toolCallIdField`, because the observer is its only user. Confirm with `grep -rn toolCallIdField packages/pi-subagents/src packages/pi-subagents/test`.
- [ ] **Step 4: Adapter.**
  - `spawn()` calls `parseLaunchMetadata(options?.metadata)` as its first statement and passes the result as `metadata` to `manager.spawn`.
  - `toSubagentRecord` sets `out.metadata` when `record.metadata !== undefined`.
  - `childSession(id)` returns `lookupChildSession(id)`.
- [ ] **Step 5: Manager and record.**
  - The value flows `AgentSpawnConfig.metadata` → `new Subagent({ execution: { metadata } })`, and `Subagent` exposes a `get metadata()` that reads it.
  - `createSubagentSession` params get `metadata: this.execution.metadata`.
  - `consultLaunchPolicy` passes `metadata: execution.metadata`.
- [ ] **Step 6: Session and publisher.**
  - `createSubagentSession` passes `metadata: params.metadata` into `launchIdentity`.
  - `createChildLifecyclePublisher.sessionCreated` calls `enterChildSession(event.sessionId, { agentId, agentType, metadata })` before `emit`, only when `agentId` and `agentType` are strings.
  - `disposed` calls `leaveChildSession(event.sessionId)` after `emit`.
- [ ] **Step 7: Gate and request.**
  - `LaunchFacts.metadata` and `LaunchRequestInput.metadata` are added.
  - `buildLaunchRequest` sets `request.metadata` only when defined. The value is already frozen.
- [ ] **Step 8: Observer.** Replace each `...toolCallIdField(record)` with `...launchFields(record)` in `onSubagentRunStarted`, `onSubagentRunFinished` and `onSubagentCreated`.
- [ ] **Step 9: Run the flow tests, expect pass**, then run the full executor suite: `bun run test:executor`. Expected: exit 0. If an existing test pins an exact payload with `toEqual`, keep its expectation, since absent metadata is omitted; only fix a test that breaks for another reason, and record it for Task 3's `VENDORED.md` rows.
- [ ] **Step 10: Commit** — `git add packages/pi-subagents/src packages/pi-subagents/test && git commit -m "feat(executor): carry launch metadata and add childSession lookup"`

---

## Task 3: Records, generated types and docs — implements 3

**Covers:** 3.1, 3.2, 3.3, 3.4, 3.5
**Difficulty:** Easy
**Blocked by:** Task 2

**Interfaces:**
- Consumes: the public Contracts rows (`LaunchMetadata`, `SpawnOptions.metadata`, `SubagentRecord.metadata`, `LaunchRequest.metadata`, `ChildSessionInfo`, `SubagentsService.childSession`, `PublishedLaunchIdentity.metadata`) to generate `dist/public.d.ts` and to document.
- Produces: none.

**Files:**
- Create: `packages/pi-subagents/test/readme-contract.test.ts`
- Modify:
  - `packages/pi-subagents/VENDORED.md`
  - `packages/pi-subagents/dist/public.d.ts`, plus `dist/settings.d.ts` if regenerated
  - `packages/pi-subagents/README.md`
  - `docs/architecture.md`, `docs/decisions/0009-vendored-executor.md`

- [ ] **Step 1: `VENDORED.md` rows.**
  - Add `seam` rows for the two new seam files and the four new test files (`test/seams/launch-metadata.test.ts`, `test/seams/child-sessions.test.ts`, `test/seams/launch-metadata-flow.test.ts`, `test/readme-contract.test.ts`).
  - Extend the existing `edit` rows, or add new ones, for every upstream file Task 2 edited, each with a one-line reason: for example "`spawn` validates `metadata`; `childSession` over the registry".
  - Run `bun test tests/vendoring.test.ts` from the root. Expected: PASS.
- [ ] **Step 2: Public types.**
  - Run `bun run --cwd packages/pi-subagents build:types`.
  - `verify:public-types` is the existing CI gate that `executor-vendoring` requires. It installs a packed consumer through `bun add`, so it may reach the package registry. That is why it is not part of the test suite, and the no-network rule for tests does not apply to it. Run `bun run --cwd packages/pi-subagents verify:public-types` where the network is available, and expect exit 0. Otherwise leave it to CI and record that in `apply.md`.
  - Check that `grep -n "childSession\|LaunchMetadata\|ChildSessionInfo" packages/pi-subagents/dist/public.d.ts` finds each name.
- [ ] **Step 3: README `spawn` contract.** Add a paragraph on `metadata` covering:
  - the limits;
  - the synchronous throw and that nothing is created on refusal;
  - frozen copy;
  - omitted when empty;
  - never on tool-call launches;
  - not persisted;
  - this sentence, verbatim: "Metadata is delivered on `pi.events` to every extension in the process; do not put secrets in it."
- [ ] **Step 4: README Events table, child events and `childSession` contract.**
  - Add `metadata` to the key fields of `subagents:created`, `started`, `completed`, `failed`, `resuming` and `resumed`.
  - In the child lifecycle section, say that `spawning`, `session-created` and `bound` carry `metadata` when the launch has it.
  - Add a `childSession` contract subsection covering:
    - the entry exists before `session-created` is dispatched, so a child's `session_start` sees it;
    - it is removed once `disposed` has been dispatched synchronously;
    - inside `session_shutdown` it holds until the handler settles or the shutdown bound expires;
    - it returns `undefined` for the main session;
    - `metadata` is `{}` when the launch had none.
- [ ] **Step 4b: README contract test.** `test/readme-contract.test.ts` reads `README.md` and asserts that it contains the verbatim sentence from Step 3 and the heading of the `childSession` contract. Run `bun run --cwd packages/pi-subagents test -- test/readme-contract.test.ts` and expect PASS.
- [ ] **Step 5: Root docs.**
  - `docs/architecture.md` seams line: add "launch metadata, child-session lookup".
  - ADR 0009 seam list: add a bullet "caller launch metadata on events, records and launch requests, and a child-session lookup".
- [ ] **Step 6: Full verification** from the root: `bun run test`, `bun run test:executor`, `bun run lint`, `bun run typecheck`. Expected: each exits 0.
- [ ] **Step 7: Commit** — `git add packages/pi-subagents/VENDORED.md packages/pi-subagents/dist packages/pi-subagents/README.md packages/pi-subagents/test/readme-contract.test.ts docs/architecture.md docs/decisions/0009-vendored-executor.md && git commit -m "docs(executor): record launch metadata seam and childSession contract"`

---

## Scenario → test

Tests are in `packages/pi-subagents/test/seams/` unless noted.

**launch-metadata / Launch metadata on service launches**
- Metadata accepted → `launch-metadata-flow.test.ts` › "Metadata accepted"
- Empty map is no metadata → `launch-metadata-flow.test.ts` › "Empty map is no metadata"; `launch-metadata.test.ts` › empty map
- Tool-call launch → `launch-metadata-flow.test.ts` › "Tool-call launch"
- Resume takes no metadata → `launch-metadata-flow.test.ts` › "Resume takes no metadata" (`expectTypeOf`)

**launch-metadata / Metadata is public within the process**
- Contract states visibility → `packages/pi-subagents/test/readme-contract.test.ts` › "spawn contract states metadata visibility"

**launch-metadata / Metadata limits** (each in `launch-metadata.test.ts`)
- Too many keys → "33 keys" case, plus `launch-metadata-flow.test.ts` › "Too many keys" (`listAgents()` unchanged)
- Bad key → "Change" case
- Value too long → "packet 1025" case
- Value at the limit → "32 keys of 1024 chars" case
- Non-string value → "unit: 3" case
- Not a plain object → array, `Map`, `null` and `Object.create({ x: "1" })` cases
- Symbol or hidden property → symbol-key and non-enumerable cases
- Null-prototype object → `Object.create(null)` case

**launch-metadata / Refused metadata**
- Nothing created on refusal → `launch-metadata-flow.test.ts` › "Nothing created on refusal" (policy spy not called, no events, `listAgents()` unchanged)

**launch-metadata / Metadata is immutable** (each in `launch-metadata-flow.test.ts`)
- Caller mutates its object → "Caller mutates its object"
- Consumer cannot write → "Consumer cannot write"
- Every surface is frozen → "Every surface is frozen" (policy spy registered; success then `resume()`)
- Empty lookup metadata is frozen → "Empty lookup metadata is frozen"

**launch-metadata / Metadata on child events** (each in `launch-metadata-flow.test.ts`)
- Child events of a launch with metadata → "Child events of a launch with metadata"
- Child events without metadata → "Child events without metadata"

**launch-metadata / Metadata on record events and snapshots** (each in `launch-metadata-flow.test.ts`)
- Queued record → "Queued record" (`maxConcurrent: 0`)
- Every record event of a launch with metadata → "Every record event of a launch with metadata"
- Failure → "Failure"
- Record events without metadata → "Record events without metadata"
- Tool-call resume of a service launch → "Tool-call resume of a service launch"

**launch-metadata / Metadata is not persisted**
- Persisted entry → `launch-metadata-flow.test.ts` › "Persisted entry" (captures `appendEntry`, reads back with `readPersistedRuns`)

**launch-metadata / Child session lookup**
- Main session and unknown ids → `launch-metadata-flow.test.ts` › "Main session and unknown ids"
- Tool-call child → `launch-metadata-flow.test.ts` › "Tool-call child"

**launch-metadata / Child session registry lifetime** (each in `launch-metadata-flow.test.ts`)
- Lookup from the child's session_start → "Lookup from the child's session_start"
- Lookup during shutdown → "Lookup during shutdown"
- Shutdown handler past the bound → "Shutdown handler past the bound" (`vi.useFakeTimers()`, a never-settling handler, advance `CHILD_SHUTDOWN_TIMEOUT_MS`)
- Present during event dispatch → "Present during event dispatch"
- Removed after disposal → "Removed after disposal"
- Failed bind → "Failed bind"
- Failed grant check → "Failed grant check" (direct `createSubagentSession`, grant-check fixture)
- Shared across executor instances → "Shared across executor instances"; `child-sessions.test.ts` › "shares entries across module instances"
- Gone after the parent session shuts down → "Gone after the parent session shuts down"

**executor-launch-policy / Launch request given to the policy**
- Tool-call origin → `launch-policy.test.ts` › "tool-call origin, agent type and requested model" (existing)
- Orchestration tools never offered → `launch-policy.test.ts` › "orchestration tools are never offered" (existing)
- Excluded extension's tool not offered → `launch-policy.test.ts` › "an excluded extension's tool is not offered" (existing)
- Locked caller value not requested → `launch-policy.test.ts` › "a locked caller value is not requested" (existing)
- Fork request → `launch-policy.test.ts` › "Fork request: no caller model → requested is the parent's model and thinking" (existing)
- Locked fork request → `launch-policy.test.ts` › "Locked fork request: the agent's locked model is requested over the caller's" (existing)
- Fallen-back fork → `test/lifecycle/subagent-manager.test.ts` › "Fallen-back fork: the launch policy receives context fresh" (existing)
- Service launch with metadata → `launch-metadata-flow.test.ts` › "Service launch with metadata"
- No metadata in the request → `launch-metadata-flow.test.ts` › "No metadata in the request"
