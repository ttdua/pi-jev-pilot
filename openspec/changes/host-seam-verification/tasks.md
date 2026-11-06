## 1. Executor dependency

- [x] 1.1 Add `@gotgenes/pi-subagents` `25.0.5` as an exact devDependency, update `bun.lock`, and test that `package.json` pins it exactly and still has no runtime `dependencies`
- [x] 1.2 Confirm `bun install --frozen-lockfile` and the existing checks (`typecheck`, `lint`, `fmt:check`, `test`) pass

## 2. Recording loopback provider

- [x] 2.1 Write the fixture server under `tests/host/`: `127.0.0.1`, OS-assigned port, streaming `POST /v1/chat/completions`, in-memory recording of every request body in arrival order
- [x] 2.2 Add scripted replies (text and tool calls) selected by request matchers, with unmatched requests answered by an error and listed
- [x] 2.3 Generate the isolated `models.json` for the fixture provider with tier-named reasoning models and OpenAI-style thinking
- [x] 2.4 Unit-test the fixture directly over HTTP: recording, matching, unmatched errors, loopback binding

## 3. Session driver and installs

- [x] 3.1 Write the harness that creates temporary agent and working directories, writes `models.json` and agent files, and removes them afterward
- [x] 3.2 Install the executor and named probe extensions into the agent dir with `pi install` under `PI_OFFLINE=1`, falling back to a packed tarball if the local install fails offline
- [x] 3.3 Spawn `pi --mode rpc` with the isolated environment, send JSONL commands (`prompt`, `compact`, `set_thinking_level`, `get_state`), and wait for the run to settle
- [x] 3.4 Give each session a probe report file through an environment variable, and read its JSON lines after the run
- [x] 3.5 Host-test the harness itself: a prompt settles with one recorded request; the agent dir is removed; the executor installs offline; a `subagent` tool call launches a child that the fixture records

## 4. Seam probes and host tests (Q1 to Q7)

- [x] 4.1 Q1: probe rewriting `model` and `thinking` in `tool_call`; host tests for foreground, background and a `locked` agent model; record observed values
- [x] 4.2 Q2: probe timing an async `message_end` against `tool_call` starts for two sibling launches; host test
- [x] 4.3 Q3: child probe removing a tool from `selectedTools`; host tests for the request `tools` list and for a scripted call to the removed tool
- [x] 4.4 Q4: probe recording `subagents:child:session-created` and the child's `session_start` session id and order; host test
- [x] 4.5 Q5: probe returning a hidden `before_agent_start` message with a marker; host tests before and after `compact`
- [x] 4.6 Q6: probe calling `setThinkingLevel` in `before_agent_start`; host test on the same turn's first request
- [x] 4.7 Q7: launch with `inherit_context: true` and a rewritten `model`; host test on the child's model and the parent marker
- [x] 4.8 Pin every Q1 to Q7 observation as fixed expected values in its test, including negative answers

## 5. Question 8 manual run

- [x] 5.1 Write `tests/host/manual/q8-claude-code.ts`: isolated agent dir, install `pi-claude-code` at commit `47f9e2b`, scripted synthetic session on `claude-code/claude-haiku-5-5` with a mid-session level change, per-turn output of level, events and cache counts, plus date and versions
- [x] 5.2 Confirm `bun run test` does not pick up the script
- [x] 5.3 Run the script once by hand with the operator's login and keep its printed output for the report

## 6. Evidence and documents

- [ ] 6.1 Write `docs/evidence/<date>-host-seams.md`: per question the answer, supporting test or run, testing level and versions, with no prompts, request bodies or account details
- [ ] 6.2 Update the host seams table in `docs/architecture.md` with each settled answer and a link to the report, and fix any contradicted statement elsewhere in `docs/architecture.md`
- [ ] 6.3 Update `docs/roadmap.md`: WG-02 done, and any later work group whose scope an answer changed
- [ ] 6.4 Update `docs/testing.md` if the harness or the Q8 procedure changes what it states
- [ ] 6.5 Search `docs/` for any remaining statement an answer contradicted, and run all checks once more
