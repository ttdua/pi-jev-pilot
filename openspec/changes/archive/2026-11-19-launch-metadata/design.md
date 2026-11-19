## Context

The vendored executor already names every launch: `launchIdentity()` in `src/seams/identity.ts` builds `{ agentId, agentType, toolCallId? }` once per session creation, and `createSubagentSession()` spreads it into `spawning`, `session-created` and `bound`. Record events get `toolCallIdField(record)` in `SubagentEventsObserver`. `toSubagentRecord()` copies facts from `Subagent` into the by-value snapshot. The launch policy's request is built and deep-frozen in `buildLaunchRequest()` from the inputs `Subagent.consultLaunchPolicy()` passes to the gate.

`session-created` is emitted synchronously before `bindExtensions()`, and `SubagentSession.dispose()` emits `disposed` after the child's `session_shutdown` and `session.dispose()`. A failed bind or failed grant check also goes through `dispose()`.

Each child session loads its own executor instance. That instance does not replace the published service (`ServicePublication` keeps an existing vendored service), so `getSubagentsService()` in a child returns the main session's adapter. A `/reload` emits `session_shutdown` first; the executor's shutdown handler unpublishes the service, aborts all agents and awaits `manager.dispose()`, which disposes every child. No child outlives a reload.

Pi's event bus calls subscribers synchronously but does not await async handlers. Child `session_shutdown` handlers are awaited up to `CHILD_SHUTDOWN_TIMEOUT_MS` (5 s), then disposal continues.

## Goals / Non-Goals

**Goals:**
- One place carries metadata from `spawn()` to every event, snapshot and policy request, next to the existing launch identity.
- A lookup that answers correctly in a child's `session_start` and, within the shutdown bound, its `session_shutdown`.
- Validation at the service boundary, before any record exists.

**Non-Goals:**
- Persisting metadata, metadata on resume, metadata on tool launches (see brainstorm.md).

## Decisions

**D1. Metadata lives on the launch, next to `parentSession` and `origin`.**
- The adapter validates the metadata and passes it on `AgentSpawnConfig.metadata`.
- The manager hands it to the `Subagent` execution config, which exposes it as a `metadata` getter.
- `LaunchSource` gains `metadata?`. `launchIdentity()` adds it when present, so all three child events get it without new call-site logic.
- The observer adds it through a `launchFields(record)` helper, next to `toolCallIdField`. Because the helper reads the record, not the run, a tool-call resume of a service launch still carries the launch's metadata.
- Alternative: a separate `metadataField()` at each emit site. Rejected: that duplicates the identity spread.

**D2. Validation is its own pure seam (`src/seams/launch-metadata.ts`).**
- `parseLaunchMetadata(input: unknown): Readonly<Record<string,string>> | undefined` throws `Error` with a message naming the rule and the offending key.
- Checks run in this order:
  1. a plain object (prototype `Object.prototype` or `null`);
  2. no own symbol keys and no non-enumerable own properties (`Reflect.ownKeys` against `Object.keys`);
  3. key count ≤ 32;
  4. each key matches the regex;
  5. each value is a string of at most 1024 UTF-16 code units (`string.length`).
- The result is a fresh null-prototype object, frozen. An empty map and `undefined` both return `undefined`.
- The adapter calls it at the top of `spawn()`, before any record or snapshot is built, so nothing is created on a refusal.
- Alternative: validate in the manager. Rejected: the manager also serves the tool door, which never carries metadata. The trust boundary is the service.

**D3. Process-wide child registry (`src/seams/child-sessions.ts`).**
- The registry is a state object `{ sessions: Map<string, ChildSessionEntry>, empty }` on `globalThis[Symbol.for("@ttdua/pi-subagents:child-sessions")]`, created on first use. `empty` is the frozen empty metadata shared by every module instance.
- It is written by the lifecycle publisher, not by subscribers:
  - `createChildLifecyclePublisher` records the entry in `sessionCreated` before it emits;
  - it deletes the entry in `disposed` after it emits.
  - So the entry exists during the synchronous dispatch of every `session-created` subscriber, and still exists during the synchronous dispatch of every `disposed` subscriber. The work an async subscriber does after its first `await` is not covered; neither is a child `session_shutdown` handler still running after the 5 s bound.
- `ChildSessionEntry` is `{ agentId, agentType, metadata }`, frozen, with `metadata` defaulting to a shared frozen empty object.
- `SubagentsService.childSession(id)` reads the registry. Because the registry is process-wide, the answer does not depend on which executor instance a consumer reaches.
- Alternative: a map on the adapter (brainstorm Alternative A). Rejected: the answer would depend on the adapter instance. Reload survival is not a reason either way, since a reload disposes every child.
- The registry keeps no reference to the session or record, so a stale entry cannot pin memory beyond three strings and a small map. A child whose dispose never runs would leave its entry; the same is already true of upstream's `disposed` subscribers.

**D4. `LaunchRequest.metadata` is optional and frozen.**
- `LaunchRequestInput` gains `metadata?`.
- `buildLaunchRequest()` sets it only when present. The value is already frozen by D2, so no copy is needed.
- `consultLaunchPolicy()` passes `this.metadata`.

**D5. Public types.**
- `SpawnOptions.metadata?: Readonly<Record<string, string>>`.
- `metadata?` on `SubagentRecord`, on `LaunchRequest`, and on `PublishedLaunchIdentity` (so on the three child event payload types).
- A new exported type `ChildSessionInfo`, and `SubagentsService.childSession`.
- The exact shapes go in plan.md Contracts. Every new field is optional, as `executor-launch-identity` "Identity fields are additive" requires. The one required addition is the service method, which consumers read and do not implement (README: "not contracts to implement").

## Risks / Trade-offs

- **[Risk] Tests leak registry state across cases through `globalThis`** → Export a test-only reset used in `afterEach`, mirroring how `composition-root.test.ts` clears the published service.
- **[Risk] A consumer treats metadata as private** → The README `spawn` contract states it is broadcast on `pi.events` and must not carry secrets.
- **[Risk] Two executor builds in one process share the registry key** → Only the vendored executor writes it. The key is namespaced `@ttdua/pi-subagents`, unlike the service key, which keeps upstream's name.
- **[Trade-off] Metadata is lost when a record is rebuilt from the session file** → Accepted and specified. A persisted record has no live session, so `childSession()` has nothing to answer for it anyway.

## Migration Plan

Additive. No migration. Rollback is reverting the change; consumers must feature-detect `childSession`.

## Open Questions

None.
