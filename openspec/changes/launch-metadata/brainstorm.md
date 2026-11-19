## Design Summary

Let an extension that launches a child through `SubagentsService.spawn()` attach caller-chosen metadata to the launch, see it on every child and record event, and look a child session up by its session id (issue #83).

**Why.** Child lifecycle events carry `agentId`, `agentType` and `sessionId`, but nothing the caller chose. Every consumer that must tell a child from the main session rebuilds the same registry (jev-pilot's `child-registry` does). pi-livespec (LS-07) loads its hooks in every in-process child. In a child they must switch to a child mode (no routing note, no phase card, no skill discovery) and must know which change, unit, lane root and packet the child runs for, so that their `tool_call` guard checks the right root. They need that answer from the child's own `session_start` until its `session_shutdown`.

**Goals**
- `SpawnOptions.metadata`: a small map of string keys to string values. The executor treats it as opaque and never reads it.
- The metadata appears on `subagents:child:spawning`, `subagents:child:session-created` and `subagents:child:bound`, on the record events (`subagents:created` through `subagents:resumed`), on the `SubagentRecord` snapshot and on the launch policy's `LaunchRequest`.
- `SubagentsService.childSession(sessionId)` returns `{ agentId, agentType, metadata }` for a live child session, and `undefined` otherwise. The answer is available inside the child's `session_start` and, within the executor's existing shutdown time bound, its `session_shutdown`.
- A launch whose metadata breaks the limits is refused with a clear error. Nothing is silently truncated or dropped.

**Non-goals**
- Metadata on `subagent` tool launches. The model cannot set it.
- Per-run metadata on `resume()`. Metadata belongs to the launch.
- Persisting metadata in the `subagents:record` session entry. After `/reload` or `/resume`, a rebuilt record has no metadata.
- Moving jev-pilot's own `child-registry` onto `childSession()`. That can follow later.
- Per-launch skills, extensions and cwd (#84).

**Anti-goals**
- Changing the name, type or meaning of any existing event or record field.
- Metadata as a secret channel. It is broadcast on `pi.events` to every extension in the process, so callers must not put secrets in it.
- An answer from `childSession()` that a caller can mutate, or that changes when the caller mutates the object it passed to `spawn()`.

**Limits** (from the issue): at most 32 keys; keys match `^[a-z][a-z0-9_.-]{0,63}$`; values are strings of at most 1024 characters.

**Living specs touched**
- `executor-launch-policy`, "Launch request given to the policy": changed explicitly. The request gains `metadata`.
- `executor-launch-identity`, "Identity fields are additive": unchanged. It already requires new fields to be optional and existing fields to keep their meaning, and this change follows it.
- `child-registry`: unchanged. jev-pilot keeps its own registry for now.
- A new capability, `launch-metadata`, holds the rest.

## Alternatives Considered

### Alternative A: Lookup registry on the service adapter or the manager
- **Approach**: The adapter keeps a map from session id to launch entry, filled and cleared by the lifecycle publisher of its own manager.
- **Pros**: No global state; simple to test.
- **Cons**: Child sessions load their own executor instance, which does not publish its service, so the answer depends on which instance holds the service slot. A second consumer pattern (jev-pilot's `child-registry`) already keeps a process-wide registry, and the two would differ.
- **Why not chosen**: The answer would be tied to one adapter instance instead of the process.

### Alternative B: Process-wide registry on `globalThis` under a `Symbol.for` key
- **Approach**: The executor fills one process-wide registry at `session-created` and clears it at `disposed`. `childSession()` reads it.
- **Pros**: Every executor instance in the process gives the same answer. It matches the pattern of jev-pilot's `child-registry`, which can later switch over without drift.
- **Cons**: Global state, which tests must reset.
- **Why not chosen**: Chosen.

### Alternative C: No lookup, events only
- **Approach**: Carry metadata on events and records only. Each consumer keeps its own registry.
- **Pros**: Smallest change.
- **Cons**: Every consumer still rebuilds the same registry, which is the problem the issue names.
- **Why not chosen**: Leaves the duplication in place.

## Agreed Approach

Alternative B: metadata on `SpawnOptions`, carried on child and record events, on `SubagentRecord` and on `LaunchRequest`, with `childSession()` backed by a process-wide registry. The user chose B and the four defaults under Key Decisions after the trade-offs were laid out.

## Key Decisions

1. The lookup registry is process-wide (`globalThis`, `Symbol.for`). It is filled when the child session is created, before the child's extensions bind, and cleared when the child is disposed, after its `session_shutdown`. A `/reload` shuts the session down and disposes every child first, so no child outlives a reload; the registry does not need to.
2. The launch policy's `LaunchRequest` carries the metadata in this change.
3. Absent metadata: events, records and `LaunchRequest` omit the field, as service launches omit `toolCallId`. `childSession()` always returns `metadata`, an empty frozen object when the launch had none. An empty object passed to `spawn()` counts as none.
4. The persisted `subagents:record` entry does not carry metadata. This is stated out of scope.
5. `spawn()` checks the metadata before creating a record: a plain object whose own properties are all enumerable string keys with string values, within the limits; symbol or non-enumerable own properties are refused, not ignored. It copies and freezes what it accepts. A violation throws synchronously with a message that names the broken rule and the offending key, and no record is created.
6. A resume keeps the record's metadata on its record events, even a tool-call resume of a service launch. `ResumeOptions` gains no metadata.
7. Ordering: this change lands before #84, which widens the same launch path.

## Open Questions

None.
