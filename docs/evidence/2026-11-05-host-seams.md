# Evidence: host seams, 2026-11-05

Answers to the eight [WG-02](../roadmap.md#wg-02-host-seam-verification) questions, from real runs of the Pi CLI in RPC mode against a loopback recording provider (Q1 to Q7) and one manual run against a real provider (Q8). Counts and ids only: no prompts, request bodies, markers or account details.

**Read with care:** Q3 to Q6 are repeatable and pinned by tests that fail if the host changes. Q1, Q2 and Q7 are superseded: the package no longer uses their seams, and their recorded answers are kept for history. Q8 is one controlled operator run, not a general rule. Links to `executor-launch-policy` point at its living spec under `openspec/specs/`.

Versions: Pi 1.5.0, `@gotgenes/pi-subagents` 25.0.5. Q8 also used `pi-claude-code` 47f9e2b and model `claude-code/claude-haiku-5-5`.

| Q | Question | Answer | Evidence | Level | Versions |
|---|---|---|---|---|---|
| Q1 | Do `input.model` and `input.thinking` mutations reach the child, foreground and background? | Superseded: recorded answer Yes. With agent `locked: model`, the agent file's model wins and thinking is still rewritten | Was `tests/host/q1-q7-worker-mutation.test.ts` (retired); replaced by [`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md) and `tests/host/launch-policy-evidence.test.ts` | Host | Pi 1.5.0, executor 25.0.5 |
| Q2 | Does `message_end` finish before `tool_call` preflight? | Superseded: recorded answer Yes. Batching at `message_end` is viable | Was `tests/host/q2-message-end-order.test.ts` (retired); replaced by [`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md) and `tests/host/launch-policy-evidence.test.ts` | Host | Pi 1.5.0, executor 25.0.5 |
| Q3 | Can a child's `before_agent_start` remove tools through `selectedTools`, and does the model then lack them? | Yes | `tests/host/q3-q4-child.test.ts` | Host | Pi 1.5.0, executor 25.0.5 |
| Q4 | Is `subagents:child:session-created` visible, in time, with a usable session id? | Yes | `tests/host/q3-q4-child.test.ts` | Host | Pi 1.5.0, executor 25.0.5 |
| Q5 | Is a hidden `before_agent_start` message sent to the model and kept across compaction as expected? | Yes. Kept until a compaction, dropped by it | `tests/host/q5-q6-main.test.ts` | Host | Pi 1.5.0 |
| Q6 | Does `setThinkingLevel` in `before_agent_start` apply to that turn's first request? | Yes | `tests/host/q5-q6-main.test.ts` | Host | Pi 1.5.0 |
| Q7 | Do mutated `model` and `thinking` still behave with `inherit_context`? | Superseded: recorded answer Yes, both apply (child model `fixture-fast`, `reasoning_effort` `high`). The seam worked; launches with `inherit_context` stayed skipped by operator decision | Was `tests/host/q1-q7-worker-mutation.test.ts` (retired); replaced by [`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md) and `tests/host/launch-policy-evidence.test.ts` | Host | Pi 1.5.0, executor 25.0.5 |
| Q8 | How do thinking changes and the prompt cache behave on `claude-code`? | No cache loss on one low to high change; no thinking-related events seen | `tests/host/manual/q8-claude-code.ts`, manual, real provider, one run | Host | Pi 1.5.0, executor 25.0.5, pi-claude-code 47f9e2b |

## Harness facts

- `--thinking <level>` reaches the provider as `reasoning_effort` unchanged.
- The executor installs offline from `node_modules`; `pi install` links local probe directories.
- `claude auth status` on macOS needs `USER` in the environment to read the keychain.

## Q1

**Superseded.** The package no longer rewrites `subagent` input in `tool_call`; the executor's launch policy sets a worker's model and thinking ([`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md), ["Launch policy host evidence"](../../openspec/specs/host-seam-evidence/spec.md)). Host evidence: `tests/host/launch-policy-evidence.test.ts`. The answer below is the one recorded on 2026-11-05.

**Observed.** A `tool_call` handler rewriting `input.model` and `input.thinking` changes the child's first request: model `fixture-fast`, `reasoning_effort` `high`. Identical for foreground and background launches. With an agent file that sets `locked: model`, the child runs the agent file's model (`fixture-main`) while thinking is still rewritten (`high`).

**Documents changed.** [architecture.md](../architecture.md#host-seams) host seams table.

**Work groups affected.** WG-11 (input mutation, `locked` handling) builds on this as designed.

## Q2

**Superseded.** The package no longer classifies launches at `message_end`; each launch is classified when the executor calls the launch policy ([`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md)). Host evidence: `tests/host/launch-policy-evidence.test.ts`. The answer below is the one recorded on 2026-11-05.

**Observed.** An asynchronous `message_end` handler that waits 300 ms completes before the first sibling `tool_call` preflight. Order: `message_end` start, `message_end` end, `tool_call` start, `tool_call` start.

**Documents changed.** [architecture.md](../architecture.md#host-seams), [workflow.md](../workflow.md) (the fallback to per-call classification is removed), [roadmap.md](../roadmap.md) WG-11.

**Work groups affected.** WG-11: batching at `message_end`.

## Q3

**Observed.** Removing `read` from `selectedTools` in a child's `before_agent_start` removes it from the child's provider request (tools left: `grep`, `ask_parent`, `notify_parent`). A call to the removed tool returns an error result ("Tool read not found").

**Documents changed.** [architecture.md](../architecture.md#host-seams) host seams table.

**Work groups affected.** none; confirms the design of WG-14 (tool removal works as `enforce` expects).

## Q4

**Observed.** `subagents:child:session-created` reaches a main-session extension subscriber before the child's `session_start`, with the same session id as the child's `ctx.sessionManager.getSessionId()`.

**Documents changed.** [architecture.md](../architecture.md#host-seams) host seams table and child detection paragraph.

**Work groups affected.** WG-11 (child registry).

## Q5

**Observed.** A `before_agent_start` message with `display: false` reaches the provider on that turn and stays in history on the next turn. After a compaction it is absent.

**Documents changed.** [roadmap.md](../roadmap.md#wg-09-skill-pick-and-delivery) WG-09 (a line about injections lost after a compaction). No other document.

**Work groups affected.** WG-09 gets a note: skills and advice injected before a compaction are gone after it ([roadmap](../roadmap.md#wg-09-skill-pick-and-delivery)).

## Q6

**Observed.** `pi.setThinkingLevel` in `before_agent_start` applies to that turn's first request (session level low, request `reasoning_effort` `high`).

**Documents changed.** none; the seam was documented and is now confirmed.

**Work groups affected.** WG-07 (main effort).

## Q7

**Superseded.** Model and thinking changes on a launch with `inherit_context` go through the launch policy ([`executor-launch-policy`](../../openspec/specs/executor-launch-policy/spec.md), ["Inherited context with a policy model"](../../openspec/specs/host-seam-evidence/spec.md)). Host evidence: `tests/host/launch-policy-evidence.test.ts`, test "Inherited context with a policy model". The answer below is the one recorded on 2026-11-05.

**Observed.** With `inherit_context: true`, a rewritten model applies and the parent conversation reaches the child. A rewritten thinking level applies too: the child's first request carried `reasoning_effort` `high` in all three runs.

**Policy.** Launches with `inherit_context` stay skipped per [domain-model.md](../domain-model.md) and [jev-contract.md](../jev-contract.md) (operator decision 2026-11-06). An open option for WG-11 is to keep the model and change only thinking on fork launches. That avoids losing the prompt cache of the forked conversation (Q8: a thinking change on one model kept the cache, one run, see [Q8](#q8)) and avoids a smaller context window. Not decided.

**Documents changed.** none.

**Work groups affected.** WG-11 (open option).

## Q8

**Observed.** One manual run on `claude-code/claude-haiku-5-5`, six turns, level changed from low to high before turn 4. Cache counts per turn:

| Turn | Level | cacheRead | cacheWrite |
|---|---|---|---|
| 1 | low | 1218 | 12858 |
| 2 | low | 13733 | 355 |
| 3 | low | 14088 | 28 |
| 4 | high | 14088 | 26 |
| 5 | high | 14114 | 28 |
| 6 | high | 14142 | 13 |

Turn 4 read the same cached prefix as turn 3 and wrote 26 tokens; Pi reported level high on turn 4 (no mismatch). No thinking-related event names were observed (`events=none`). Run on 2026-11-06T00:25:23Z.

**Limits.** One run, one model, one direction of change. It shows no cache loss in that run; it does not show that no provider loses cache.

**Documents changed.** [roadmap.md](../roadmap.md) WG-08 note, [configuration.md](../configuration.md) `effort.holdProviders` note, [testing.md](../testing.md) Host level.

**Work groups affected.** WG-08: `claude-code` is not in the default hold list.

## `before_agent_start` signal (WG-07)

Added with [WG-07](../roadmap.md#wg-07-main-effort); not one of the eight WG-02 questions. Source reading at Pi 1.5.0, plus the host test `tests/host/main-effort.test.ts` "esc starts nothing" (testing level: Host).

**Observed.** `ctx.signal` reads `agent.signal`, which exists only while a run is active. `_startRun` in `agent-session.js` awaits every `before_agent_start` handler (in `_prepareRun`) before `agent.prompt` creates the run, so `ctx.signal` is `undefined` throughout the handler. Esc during that time only sets a flag; Pi aborts the run at `agent_start`, before any provider request, and `agent_settled` then fires with `aborted: true`. The host test confirms the result: with Esc sent while Jev is still answering, no provider request is recorded, the thinking level after the turn equals the level before, and no ledger line exists. The package cannot see the Esc while it waits, so it restores the replaced level when the run settles aborted with no provider request.

**Limits.** The source reading is tied to Pi 1.5.0. The host test covers one Esc timing (during the Jev wait).

**Documents changed.** [architecture.md](../architecture.md#host-seams) host seams table and failure model, [workflow.md](../workflow.md#1-a-main-prompt), [usage-guide.md](../usage-guide.md), [jev-questions.md](../jev-questions.md#wire-format), [roadmap.md](../roadmap.md) WG-07 status.

**Work groups affected.** WG-07. The restore may become removable once Pi exposes a signal in `before_agent_start`; an upstream issue is drafted in the WG-07 change and not yet posted.

## Tool assessment service lookup (WG-14)

Added with [WG-14](../roadmap.md#wg-14-tool-assessment-observe-only); not one of the eight WG-02 questions. Pi 1.5.0 with `@gotgenes/pi-subagents` 25.0.5, host test `tests/host/tool-assessment.test.ts` (testing level: Host).

**Observed.** A worker finds its launch by matching its session file with `outputFile` in the executor service's `listAgents()`. A worker session loads its own executor instance, which overwrites the global service, so the service captured by the main session at `session_start` is used, and a worker's shutdown never clears it. At the worker's first `before_agent_start` the record was already present: the tool request reached Jev with `state.agent.name` equal to the launched agent. Two concurrent background workers each named their own agent. Child tool lists (names only): a default worker had `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `ask_parent`, `notify_parent`; the request keyed the first seven and never the last two (7 scored, 1 flagged). In `enforce` the child's list lacked `edit` on every request, and a call to `edit` returned "not found". A built-in agent with declared tools (`Explore`) sent no tool request. With Jev answering 500 in `enforce`, the child kept the same tools as a run with the `tools` switch off. A prompt marker appeared in the Jev request and in no file of the `jev` directory.

**Limits.** One executor version, one Pi version, and a fixture standing in for Jev. The result depends on the executor keeping launch records reachable through `listAgents()` by `outputFile`.

**Documents changed.** [architecture.md](../architecture.md#host-seams) host seams, layout, failure model and performance budget, [jev-contract.md](../jev-contract.md#tool-assessment), [jev-questions.md](../jev-questions.md#tool-assessment), [domain-model.md](../domain-model.md#toolassessment), [workflow.md](../workflow.md#3-a-worker-starts), [usage-guide.md](../usage-guide.md), [roadmap.md](../roadmap.md) WG-14 status.

**Work groups affected.** WG-14. The criterion wording stays provisional until the replay in WG-16.
