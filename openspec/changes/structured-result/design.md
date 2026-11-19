## Context

The vendored executor (`packages/pi-subagents/`) installs child protocol tools in `buildChildTools()` (`src/lifecycle/create-subagent-session.ts`): `ask_parent` for every fresh child, `notify_parent` for background children with updates on. A fork gets none, because its declarations must equal the parent's to share the prompt cache. A run's outcome lives on `SubagentRun` (`result`, `pendingQuestion`, …) and is exposed through `Subagent`, the `SubagentRecord` snapshot built in `service-adapter.ts`, and the payload `buildEventData()` gives `subagents:completed` / `failed` / `resumed`. The turn loop in `SubagentSession.promptForAnswer()` already stops a run at a turn boundary (turn budget) by calling `session.abort()` at `turn_start`, and `Subagent.complete()` maps that to `completed` unless the budget phase is `exhausted`.

Pi's agent loop validates every tool call's arguments against the tool's declared `parameters` (with coercion) and returns the errors to the model as a tool error before `execute` runs. A tool result may set `terminate: true`, but the loop stops early only when every tool result in the batch sets it.

## Goals / Non-Goals

**Goals:**
- Typed, validated child results for `fresh` service launches, with errors reported to the child while it can still fix them.
- No observable change for launches without a schema.

**Non-Goals:**
- Fork support, frontmatter schemas, a `subagent` tool parameter, full JSON Schema.
- Showing `structuredResult` to the parent model through `get_subagent_result` or notifications; those keep rendering the free text.
- Persisting `structuredResult` in the `subagents:record` session entry.

## Decisions

### Own subset checker and validator, no new dependency
`src/seams/result-schema.ts` holds two pure functions: `parseResultSchema(input)` checks the subset and returns a frozen deep copy or throws; `validateResult(schema, value)` returns a list of `{ path, message }` errors. Allowed keywords: `type` (one of the six, a single string), `enum` (non-empty array of JSON scalars), `properties`, `items` (one schema), `required` (unique strings), `additionalProperties` (boolean or schema), and annotations `title`, `description`, `$schema` (only the draft 2020-12 URI). Anything else throws, naming the keyword and its JSON Pointer. `integer` means a number with `Number.isInteger`. The root must declare `type`.
- Why over `@earendil-works/pi-schema`: the package does not declare it, and a hand-written subset validator is about a hundred lines, deterministic, and fully under the tests. Refusing unsupported keywords means a caller never believes a constraint is enforced when it is not.

### Tool parameters wrap the caller's schema
`submit_result` declares `parameters: { type: "object", properties: { result: <schema> }, required: ["result"], additionalProperties: false }`. The model sees the exact shape, and Pi's own argument validation rejects most bad calls before `execute`, returning its errors to the child. Wrapping lets the root schema be any of the six types; provider tool parameters must be objects.
- `execute` validates `params.result` again with `validateResult` and is the authority on what is stored: whatever Pi lets through, nothing outside the subset's rules is stored. On failure it returns the errors as an error result (`isError: true`) with the paths, so the child can retry.
- Pi coerces before `execute` (for example `"42"` to `42` for an integer), so `execute` never sees the raw argument. The stored value is the coerced one that passed `validateResult`; the spec states this as behaviour.

### Attempt tracking from tool events
"invalid" means the run called `submit_result` and never succeeded, including calls Pi rejected before `execute`. The run records an attempt on every `tool_execution_start` whose `toolName` is `submit_result`, through the turn-loop subscription `SubagentSession` already holds. At settlement: a stored value → `structuredResult`; else an attempt → `"invalid"`; else `"missing"`.

### First valid submission is final for the run
A valid call stores the value on the current `SubagentRun` and returns `terminate: true`. Later calls in the same run return an error result saying a result was already submitted and change nothing. This keeps one answer per run and makes "ends after the current turn" unambiguous.

### Ending the run after the current turn
`terminate: true` stops the loop when `submit_result` is the batch's only tool. When the batch has other tools, the loop would start another turn. The turn loop composes Pi's completed-turn hook `session.agent.finishTurn` (public `AgentSession.agent`, `Agent.finishTurn` in pi-agent-core 1.5.0, the same composition `AgentSession` itself uses): the wrapper calls the previous hook, then returns `{ action: "end" }` when the run holds a structured result. Pi runs the hook after the turn's tool results and before `turn_end`, and `end` exits without polling queues or preparing another request, so no further provider request is made. The wrapper is installed per run and restored when the run's turn loop ends.
- Why not `session.abort()` at `turn_start` (the turn-budget lever): Pi prepares and sends the next provider request after `turn_start`, so an abort there still issues a request (with an aborted signal) and may compact first. The free-text `result` is the collected response text as today.

A submission on the ceiling turn: `TurnBudgetTracker.onTurnEnd()` marks a tool-bearing ceiling turn `exhausted`, and `Subagent.complete()` maps `exhausted` to `aborted`. `complete()` therefore treats a run holding a structured result as `completed` regardless of the budget phase (the budget snapshot still reports `exhausted`, which is what happened). An external stop (`abort(id)`, a caller signal) marks the run `stopped` at once through `Subagent.abort()`, and `SubagentRun.markCompleted` / `markAborted` never overwrite `stopped`, so it keeps that status; the stored structured result stays on the run.

### Error kind derived from the run's own state
`structuredResultError` is a getter on `SubagentRun`, derived from: the launch expects a result, the run is terminal and not stopped while queued, no value is stored, and the run's own stored question (`_pendingQuestion`, not the `pendingQuestion` accessor, which reads `undefined` once a resume replaces the run). A settled run's outcome therefore never changes when a resume replaces it.

### Per-run outcome on `SubagentRun`
`structuredResult` and `structuredResultError` live on `SubagentRun`, so a resume (a new run) starts with both cleared, matching the approved per-run rule. `structuredResultError` is set at completion only when the run ends without a stored value and without a pending question. A run that ends `error`, `aborted` or `stopped` also gets `"missing"` / `"invalid"` (it ended without one); a queued run stopped before starting gets nothing (it never ran).
- The schema itself lives on the launch (`Subagent` execution config) and is passed to each run's session creation; a resume reuses the live session, whose `submit_result` was installed at creation and writes to whichever run is current.

### Refusals in `spawn`, before anything is created
`service-adapter.ts spawn()` parses the schema next to `parseLaunchMetadata`, before the session check. After `resolveContext`, a `fork` context with a schema throws an error naming `resultSchema` and `fork`. A fork from a locked agent file is refused the same way. A fork that later falls back to `fresh` (no parent session) is still refused: the check uses the resolved context before fallback, so the caller's request is judged, not an accident of state.

### `submit_result` is owned and protected
`OWNED_TOOLS` in `launch-request.ts` gains `submit_result`, so it never appears in `toolSet.parentTools`. In `freshSetup`, protocol tools bypass `disallowed` and policy `removed` lists for `submit_result` only (`ask_parent`/`notify_parent` keep today's behaviour). The tool counts as the child's own tool in run facts, like `ask_parent`.

### Not persisted, not public on the persisted entry
`toPersistedRecord` is unchanged. A structured result is tool-argument content; jev-pilot's invariant forbids storing tool arguments, and the session entry is for history reconstruction. The value lives in memory on the record and on the events only.

## Risks / Trade-offs

- [Pi argument validation differs from ours (coercion, keyword semantics)] → `execute` re-validates; subset keywords have identical semantics in both.
- [A provider rejects the wrapped schema in tool parameters] → the subset is the common portable core of tool-schema support; README documents the subset.
- [A child never calls `submit_result`] → `"missing"` plus the free text; the caller decides whether to resume. The tool description tells the child to call it before finishing.
- [The `finishTurn` wrapper breaks another hook or leaks past the run] → it calls the previous hook first and keeps its `end`/`continue` decision when no result is held, and is restored in `finally`, also when the prompt throws.
- [Large schemas bloat every child request] → caller's responsibility; no size limit in this change (skipped: add when a caller hits provider limits).

## Migration Plan

Additive. No migration; rollback is reverting the change. `dist/public.d.ts` regenerates with the new optional fields.

## Open Questions

None blocking. Fork support via declaring `submit_result` on the parent stays a separate issue.
