## Why

An extension that launches a child with `SubagentsService.spawn()` cannot tie the child session back to its own launch: child events carry only executor-chosen ids. Every consumer rebuilds a child registry, and pi-livespec (LS-07) needs, inside each child's own hooks, to know it is a child and which change, unit and lane root it runs for (#83).

## What Changes

**Launch metadata**
- From: `SpawnOptions` has no caller data; child and record events carry `agentId`, `agentType`, `toolCallId` only.
- To: `SpawnOptions.metadata`, a map of string keys to string values. The executor checks the map's shape and limits but never reads its content. It is carried on:
  - `subagents:child:spawning`, `subagents:child:session-created` and `subagents:child:bound`;
  - the record events `subagents:created`, `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:resuming` and `subagents:resumed`;
  - the `SubagentRecord` snapshot;
  - the launch policy's `LaunchRequest`.
- Absence: absent metadata is omitted everywhere, and an empty map counts as absent. Tool-call launches never carry metadata.
- Reason: a caller can recognise its own launches without a side registry.
- Impact: additive. New optional fields only.

**Limits**
- To: at most 32 keys; keys match `^[a-z][a-z0-9_.-]{0,63}$`; values are strings of at most 1024 characters; the map is a plain object whose own properties are all enumerable string keys.
- `spawn()` throws on a violation and creates no record.
- What is accepted is copied and frozen.

**Child session lookup**
- To: `SubagentsService.childSession(sessionId)` returns `{ agentId, agentType, metadata }` for a live in-process child and `undefined` otherwise. `metadata` is an empty frozen object for a launch without metadata.
- The answer is valid from the child's `session_start` through its `session_shutdown` (within the executor's shutdown bound). It is backed by one process-wide registry; a `/reload` disposes every child first, so no entry outlives it.
- Impact: additive service method.

**Out of scope**
- The persisted `subagents:record` entry does not store metadata.
- `resume()` takes no metadata.
- jev-pilot's `child-registry` keeps its own registry.
- Per-launch skills, extensions and cwd are #84.

## Capabilities

### New Capabilities
- `launch-metadata`: caller metadata on service launches (limits, refusal, immutability), its presence on child events, record events and record snapshots, and the `childSession()` lookup.

### Modified Capabilities
- `executor-launch-policy`: "Launch request given to the policy" gains `metadata`.

## Impact

- **Vendored executor (`packages/pi-subagents/`):**
  - `src/service/service.ts` and `src/service/service-adapter.ts`
  - `src/seams/identity.ts`
  - `src/lifecycle/child-lifecycle.ts`, `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/subagent.ts` and `src/lifecycle/subagent-manager.ts`
  - `src/seams/launch-request.ts` and `src/seams/launch-gate.ts`
  - `src/observation/subagent-events-observer.ts`
  - new seam files for metadata validation and the child-session registry
  - tests
- **Records:** every edited upstream file gets a row in `VENDORED.md`. `dist/public.d.ts` is regenerated, and `verify:public-types` must pass.
- **Docs:**
  - `packages/pi-subagents/README.md` (the `spawn` contract, Events, and a `childSession` contract);
  - `docs/architecture.md` (the seams line lists launch metadata and the child lookup);
  - `docs/decisions/0009-vendored-executor.md` (seam list).
- **jev-pilot `src/`:** no change.
