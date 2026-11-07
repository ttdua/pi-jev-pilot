## 1. Pure rules

- [x] 1.1 Add `src/policy/tools.ts`: `toolCandidates` (drop `ask_parent` and `notify_parent`, keep order, cap 32), `flaggedTools` (valid noul at least 0.5, unknown names ignored) and `toolCounts`, with unit tests in `tests/policy/tools.test.ts` (Candidates, Flagging, Observe and enforce: Never adds)

## 2. Jev request

- [ ] 2.1 Add `TOOL_QUESTION` wording to `src/jev/rubrics.ts` and `buildToolQuestions(names)` to `src/jev/questions.ts` (one noul per name, key `tool::<name>`), with tests in `tests/jev/questions.test.ts` (Assessment request: One noul per candidate)
- [ ] 2.2 Add `cutLastCodePoints` to `src/shared/text.ts` and `buildToolState` to `src/jev/state.ts`: brief cut to its last 4000 code points, agent name/source/description, tools with description, source and top-level parameter descriptions cut to 500 code points, with tests in `tests/jev/state.test.ts` (Assessment request, Brief)

## 3. Host handler

- [ ] 3.1 Add the main-session executor service capture in `src/host/tool-service.ts` (set at main `session_start`, cleared at main `session_shutdown`, never from a child), the process-wide tool counts map keyed by agent id, bounded at 256, in `src/host/tool-counts.ts`, and the `ToolInfo` mapping in `src/host/tool-facts.ts`, each with unit tests (Captured executor service, Tool metadata from Pi)
- [ ] 3.2 Add `createToolAssessment` in `src/host/tools.ts`: first-call gate from `loadSnapshot` and the capture, record lookup by `getSessionFile()` against `outputFile`, `readAgent`, candidates from `selectedTools`, metadata from `pi.getAllTools()`, `askJev` with `classifier.timeoutMs`, flag, store per-session outcome and mode, splice in `enforce`, reuse on later calls, catch every error; unit tests with fakes (When assessment runs, Worker finds its launch, Only agents that declare no tools, The worker waits for the answer, Once per worker, Fail open, Counts handed to the worker line)
- [ ] 3.3 Wire it in `src/host/setup.ts`: capture in the main `session_start`, clear in the main session's `session_shutdown` only (a child's shutdown leaves it), call `beforeAgentStart` in the child branch after `hideReviewInChild`
- [ ] 3.4 In `src/host/worker.ts` `write()`, take and delete the counts for the launch's agent id and set `toolsScored` and `toolsFlagged`; resumed launches take none; extend `tests/host/worker-ledger.test.ts` (worker-ledger Decision fields: Tool counts recorded, No assessment no counts, Resumed launch carries no counts)

## 4. Host tests

- [ ] 4.1 Add `tests/host/tool-assessment.test.ts` with the real executor, the loopback provider and a loopback Jev fixture: `observe` keeps every tool in the child's first request and the `worker` line has the counts; `enforce` removes a flagged tool from the child's requests and a call to it returns an error result; Jev refused in `enforce` keeps every tool; an `Explore` worker sends no tool request; no prompt marker in the ledger
- [ ] 4.2 In the same file, record evidence that the record is found at the child's first `before_agent_start` (the design's open timing question) and two concurrent background workers each name their own agent

## 5. Docs

- [ ] 5.1 Update `docs/jev-contract.md`, `docs/jev-questions.md`, `docs/domain-model.md`, `docs/workflow.md`, `docs/usage-guide.md` and `docs/architecture.md` (host seams, layout, performance budget) for the agreed behaviour
- [ ] 5.2 Add the service lookup section to `docs/evidence/2026-11-05-host-seams.md` from task 4.2, and set WG-14 to Done in `docs/roadmap.md`
- [ ] 5.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass
