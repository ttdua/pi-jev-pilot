## Context

The extension runs twice in one process: once in the main session and once in each worker (child) session, as separate module instances that share only `globalThis`. Today the child instance does one thing in `before_agent_start`: `hideReviewInChild` removes `jev_review` from `systemPromptOptions.selectedTools` (`src/host/setup.ts`, `src/host/review.ts`). Worker routing (`src/host/worker.ts`) runs in the parent, knows each launch's agent facts at `tool_call`, and writes one `worker` ledger line per launch once the executor's outcome arrives, keyed by the executor agent id (`byAgent`, `outcomes`). The ledger schema already allows `toolsScored` and `toolsFlagged` on `worker` lines (`src/store/ledger-schema.ts`); nothing sets them yet.

Facts from `@gotgenes/pi-subagents` 25.0.5 source that shape this design:

- `subagents:child:session-created` is emitted synchronously after the child session (and its session file) is created and before `bindExtensions()`; its payload has only `sessionId` and `parentSessionId`.
- The executor publishes `getSubagentsService()` on `globalThis` under `Symbol.for("@gotgenes/pi-subagents:service")`. `listAgents()` returns by-value `SubagentRecord`s with `id`, `type`, `description` and `outputFile` (the child's session file, set once the session exists).
- The child loads every extension the parent has, including the executor itself (only its tools are excluded). The executor's factory publishes the service when it loads and unpublishes it on `session_shutdown`. A child's extensions load in `loader.reload()`, before `session-created` is emitted, so from the first child on the global may point at a child's own, empty service, or at nothing after that child shuts down.
- `Subagent.run()` assigns the session before it calls `runOnSession()`, which prompts; so by the child's first `before_agent_start`, the parent service's record has `outputFile`.
- The first prompt is the brief, prefixed by the parent context only when `inherit_context` is set.

## Goals / Non-Goals

**Goals:**
- One Jev request per worker whose agent declares no `tools`, at the child's first `before_agent_start`, waited for in both modes.
- `enforce` removes flagged tools on every turn of that worker; `observe` removes nothing.
- Counts reach the launch's `worker` line when one is written.
- Every failure path keeps every tool and writes no counts.

**Non-Goals:**
- Logging failures to a verbose log (WG-17 owns logging; failures here are silent).
- `/jev` commands for `tools.mode` (config only).
- Replay-verified wording (WG-16).

## Decisions

### D1. Capture the main session's executor service at its `session_start`

The main instance, in its `session_start` (not a child), reads the service from `globalThis` and stores the reference in a process-wide slot (`Symbol.for("pi-jev-pilot.mainService")`). No child exists yet at that moment, so the global is the main executor's service. Each main `session_start` replaces the slot, so a reload or a new session captures the fresh service; the main instance's `session_shutdown` clears it. The child reads only this captured reference, never the live global.

- **Why**: the live global is unreliable once any child has loaded (see Context).
- **Alternative**: read the global in the child. Rejected: it is the child's own empty service, so the lookup would always miss.
- **Alternative**: capture in the `session-created` handler. Rejected: the child's executor has already loaded and overwritten the global by then.
- **Alternative**: import `@gotgenes/pi-subagents`. Rejected: adds a dependency for one accessor; the published `Symbol.for` key is the executor's documented cross-extension contract.

### D2. Find the record by session file in the child

At the first `before_agent_start` of a child, the handler takes `ctx.sessionManager.getSessionFile()`, calls `listAgents()` on the captured service, and picks the one record whose `outputFile` equals it. No match, several matches, a throwing call or a missing service: no assessment, all tools kept. Agent facts come from `readAgent(record.type, { cwd, agentDir })`, the function routing uses, so `declaredTools` means the same in both places.

### D3. Pure rules in `policy/tools.ts`, request shape in `jev/`

- `policy/tools.ts` (pure): `toolCandidates(selected)` drops `ask_parent` and `notify_parent`, keeps order, caps at 32; `flaggedTools(answers, scored)` returns names whose `tool::<name>` noul is at least 0.5; `toolCounts` gives `{ toolsScored, toolsFlagged }`. The 0.5 threshold and the 32 cap are constants here.
- `jev/state.ts` gains `buildToolState({ brief, description, agent, tools })`, matching `jev-contract.md`: `task`, `agent` (`name`, `source`, `description`), `tools` keyed by name with `description`, `source` and `parameters` (each top-level parameter name to its description).
- `jev/questions.ts` gains `buildToolQuestions(names)`: one noul per name, key `tool::<name>`, wording from `jev/rubrics.ts` (pinned from `jev-questions.md`).
- Answers are read with the existing `readAnswers`; a tool with no valid answer is not flagged (fails open per tool). A request miss or cancel flags nothing and records no counts.

### D4. Host modules

`host/tool-service.ts` holds the capture (D1), `host/tool-counts.ts` the counts map (D6), `host/tool-facts.ts` the mapping from Pi's `ToolInfo` (`sourceInfo.source`, `parameters.properties.*.description`) to the request's tool entry. The handler lives in `host/tools.ts`.

### D4a. Handler

`createToolAssessment(pi, deps)` returns `beforeAgentStart(event, ctx)`, called from the child branch of `before_agent_start` in `setup.ts` right after `hideReviewInChild`. It keeps a per-instance map from child session id to its outcome (`pending`, `flagged: Set<string>`, or `none`). First call per session: gate, look up, ask, decide, store the flagged set and the mode read then. Later calls (later turns, resumed runs): reuse the stored set and mode; in `enforce`, splice flagged names out of `selectedTools` again. A first call that sent nothing or got no answer stores `none`, which is never retried. A first run whose `messageType` is not `user`, or an empty prompt, stores `none`. Every step is in a try/catch that leaves `selectedTools` untouched.

Gate, read fresh with `loadSnapshot` at the first call: config valid, key set, `tools` switch on, and a captured main service exists (that is what "executor present" means in a child, since the executor removes `subagent` from child tools).

### D5. Brief

The brief is the first prompt (`event.prompt` when `messageType` is `user`), cut to its last 4000 code points. With `inherit_context` the executor prepends the parent context, and the record does not say whether the launch inherited context, so a cut from the end is the only rule that keeps the brief in both cases. Worker routing cuts from the start; the two differ only for briefs over 4000 code points, which is accepted. The brief is sent, never stored.

### D6. Counts handed back by agent id

When a worker is assessed with an answer, the child writes `{ toolsScored, toolsFlagged }` into a process-wide map keyed by the record's `id` (`Symbol.for("pi-jev-pilot.toolCounts")`, bounded like routing's maps at 256 entries). The parent's `write()` in `worker.ts` takes and deletes the entry for the launch's agent id when it writes the line. The child finishes assessing before its first turn, long before the executor's completion event, so the entry is present when the line is written. With no `worker` line (switch off, skipped launch), the entry is evicted by the bound and never written. A resumed launch's line finds no entry, so it carries no counts.

### D7. Waiting

The child awaits the request in both modes with `classifier.timeoutMs` (the client's own timeout). `ctx.signal` is undefined in `before_agent_start` (WG-07 evidence), so no abort signal is passed.

## Risks / Trade-offs

- [The capture in D1 or the record timing in D2 differs at runtime from the source reading] → A host test with the real executor asserts that `observe` records counts; if the lookup misses, the test fails rather than silently scoring nothing. If it fails for a reason the design cannot fix, stop and ask before falling back to brief matching.
- [A child's `session_shutdown` unpublishes the executor's global, which may also affect other consumers] → Not ours to fix; the captured reference is unaffected. Noted in the evidence report.
- [Every worker with no declared tools waits up to `timeoutMs` in `observe` too] → Operator decision; documented in the usage guide and the performance budget.
- [A wrong removal in `enforce` can leave a worker stuck] → `observe` is the default; removal needs a config edit; the usage guide already warns.
- [Tool descriptions from extensions can be long] → Descriptions and parameter descriptions are cut to 500 code points in `buildToolState`, so a request stays near the contract's 6 KB.
- [A resumed launch might start a new session] → Executor 25.0.5 resumes on the same `SubagentSession`; the per-instance outcome map covers it. A resumed launch's `worker` line carries no counts (D6).
