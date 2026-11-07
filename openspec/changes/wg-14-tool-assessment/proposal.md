## Why

Workers whose agent declares no `tools` get every tool the parent has, including ones their task never needs. WG-14 (issue #15, roadmap H2) is done when Jev scores those tools inside the worker, `observe` mode records what would be removed without changing the worker, `enforce` mode removes the flagged tools, and a Jev failure keeps every tool. Recording first lets the operator judge removal on real ledger data before turning it on.

## What Changes

- In a worker session, at its first `before_agent_start`, find the executor record for this session by matching `outputFile` from `getSubagentsService().listAgents()` with the session file; read the agent's facts the same way worker routing does.
- When the agent declares no `tools` and the feature may run (`tools` switch on, valid config, key set, executor present), send one tool assessment request: task, agent, and for each candidate tool its description, source and parameter descriptions from `pi.getAllTools()`; one noul `tool::<name>` per candidate, at most 32.
- Candidates are the worker's selected tools except `ask_parent` and `notify_parent`; `jev_review` is already removed before assessment.
- A tool whose noul is at least 0.5 is flagged. `observe` removes nothing; `enforce` removes flagged tools from `selectedTools` on every `before_agent_start` of that worker, without a new request.
- The worker waits for the answer in both modes, bounded by `classifier.timeoutMs`. Any failure, a missing record or a lookup error keeps every tool.
- Hand `toolsScored` and `toolsFlagged` to the parent through a process-wide map keyed by the executor agent id; the existing `worker` ledger line carries them when it is written. With no `worker` line, the counts are recorded nowhere.
- Pin the tool question wording and the request shape in the Jev contract.

Docs updated:
- `docs/jev-contract.md`: tool assessment state, where the brief comes from, candidates, the 32 cap.
- `docs/jev-questions.md`: tool assessment wording (still provisional until replay).
- `docs/architecture.md`: host seams rows for the executor service lookup; the new `host/` and `policy/` modules in the layout; the performance budget row (the worker waits in both modes).
- `docs/workflow.md`: the worker start sequence (record lookup, waiting in both modes, counts handed back).
- `docs/domain-model.md`: `ToolAssessment` (once per worker, candidates, counts only on an existing worker line).
- `docs/usage-guide.md`: where the counts appear, and that `observe` adds a bounded wait.
- `docs/evidence/2026-11-05-host-seams.md`: a section for the service lookup timing, from the new host test.
- `docs/roadmap.md`: WG-14 status.

## Capabilities

### New Capabilities
- `tool-assessment`: when a worker's tools are assessed, how the worker finds its launch, the request and its candidates, the threshold, `observe` and `enforce`, reuse across turns, and failing open.

### Modified Capabilities
- `worker-ledger`: the `worker` line carries `toolsScored` and `toolsFlagged` when that worker was assessed.

## Impact

- New code: `src/policy/tools.ts` (pure candidate, cap and flag rules); additions to `src/jev/state.ts`, `src/jev/questions.ts`, `src/jev/rubrics.ts` and `src/shared/text.ts`; in `src/host/`, `tools.ts` (worker-side handler, record lookup), `tool-service.ts` (service capture), `tool-counts.ts` (counts map) and `tool-facts.ts` (`ToolInfo` mapping).
- Changed code: `src/host/setup.ts` (wiring in the child branch of `before_agent_start`), `src/host/worker.ts` (read counts by agent id when writing the line).
- Ledger format, `config.json` and `state.json` unchanged: `toolsScored` and `toolsFlagged` already exist in the schema. No new dependency: the executor service is read from `globalThis` under its published `Symbol.for` key, not imported.
- New host test with the real executor: `observe` keeps tools and records counts, `enforce` removes a flagged tool, Jev down keeps all tools.
