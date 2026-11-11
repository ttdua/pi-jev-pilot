# tool-assessment Specification

## Purpose
When a worker's tools are assessed, how the worker finds its launch, the request and its candidates, the threshold, `observe` and `enforce`, reuse across turns, and failing open.

## Requirements

### Requirement: When assessment runs
Tool assessment SHALL run inside the main session's launch policy (see `worker-routing`), for every launch that policy routes or would route, with conditions read fresh at each policy call. It MUST do nothing, and call Jev for nothing, when `config.json` is invalid, the API key is unset, the `tools` switch is off, the executor is absent or duplicated, or the launch comes from a worker. Doing nothing MUST leave the launch's tools exactly as without assessment. It SHALL run whether or not the `subagents` switch is on. A resumed launch is never assessed, since it never reaches the policy.

#### Scenario: Switch off
- **WHEN** the `tools` switch is off and a worker is launched
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: No key
- **WHEN** the API key is unset and a worker is launched
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and a worker is launched
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Executor absent
- **WHEN** the executor is not installed and a prompt starts
- **THEN** no tool assessment request is sent

#### Scenario: Main session
- **WHEN** a prompt starts in the main session and launches no worker
- **THEN** no tool assessment request is sent

#### Scenario: Routing off, assessment on
- **WHEN** the `subagents` switch is off, the `tools` switch is on, and a worker is launched
- **THEN** one tool assessment request is sent and no worker request is sent

#### Scenario: Mode read once
- **WHEN** `tools.mode` changes from `observe` to `enforce` while a worker runs
- **THEN** that worker keeps the tools decided under the mode read at its launch

### Requirement: Candidates
Candidates SHALL be taken from the launch request's `toolSet`, in this order, without duplicates and after the exclusions in "Agent author's tools are never assessed":
- **Block candidates:** the `defaults` the child would get.
- **Grant candidates:** the `parentTools` not among the defaults.

At most 32 candidates in total SHALL be scored: block candidates first, then grant candidates, in order. Block candidates beyond the cap MUST stay allowed, and grant candidates beyond it MUST NOT be granted. With no candidate, no request is sent.

#### Scenario: Default and grant candidates
- **WHEN** an agent declares no `tools`, the defaults are `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, and the parent also has `web_search`
- **THEN** the seven defaults are block candidates and `web_search` is a grant candidate

#### Scenario: Declared agent has only grant candidates
- **WHEN** an agent declares `tools: read` and the parent has `read` and `web_search`
- **THEN** there is no block candidate and `web_search` is the only grant candidate

#### Scenario: Protocol tools never candidates
- **WHEN** a launch's defaults are `read` and `bash`, and the parent also has `ask_parent` and `notify_parent`
- **THEN** the request scores exactly `read` and `bash`

#### Scenario: Review tool never a candidate
- **WHEN** a worker is launched and `jev_review` is registered
- **THEN** the request has no question for `jev_review`

#### Scenario: Cap at 32
- **WHEN** a launch has 7 block candidates and 30 grant candidates
- **THEN** the request scores the 7 block candidates and the first 25 grant candidates, and the other 5 are not granted in any mode

### Requirement: Assessment request
The request SHALL carry `task` (brief and description), `agent` (name, source, description) and `tools` keyed by candidate name with the description, source and top-level parameter descriptions from `pi.getAllTools()`, each description cut to 500 code points. It SHALL ask one noul `tool::<name>` per block candidate, and one noul `grant::<name>` per grant candidate, with the wording in `docs/jev-questions.md`. It MUST NOT contain tool arguments, tool output, or any model or thinking setting. It SHALL be sent concurrently with the launch's worker request, if any, as a separate request.

#### Scenario: One noul per candidate
- **WHEN** the block candidates are `read`, `edit` and `bash` and the grant candidate is `web_search`
- **THEN** the request has exactly `tool::read`, `tool::edit`, `tool::bash` and `grant::web_search`, each of type noul

#### Scenario: Tool metadata from Pi
- **WHEN** `bash` is a candidate
- **THEN** `tools.bash` has the description Pi reports for `bash` and its `command` parameter description

#### Scenario: Long tool description
- **WHEN** a candidate's description is 900 code points
- **THEN** its `description` in the request is the first 500 code points

#### Scenario: Concurrent with routing
- **WHEN** a launch is routed and assessed
- **THEN** both requests are in flight at the same time, and the launch waits for both, bounded by the classifier timeout

### Requirement: Brief
The brief SHALL be the last 4000 code points of the launch request's `prompt`. An empty prompt MUST mean no request. The brief MUST be sent only, never stored. Forked launches carry the brief without the inherited context.

#### Scenario: Long brief
- **WHEN** a launch's prompt is 5000 code points
- **THEN** `task.brief` is its last 4000 code points

#### Scenario: Forked worker
- **WHEN** a launch inherits context
- **THEN** `task.brief` is the launch's own prompt, without the parent's conversation

#### Scenario: Empty prompt
- **WHEN** a launch's prompt is empty
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Brief not stored
- **WHEN** a launch with a brief containing a unique marker is assessed
- **THEN** no ledger file contains that marker

### Requirement: The worker waits for the answer
The launch SHALL wait for the tool assessment answer in both `observe` and `enforce` before its child session is created, bounded by `classifier.timeoutMs` read fresh at that launch's policy call. Routing and assessment requests of one launch share that one deadline.

#### Scenario: Slow answer in observe
- **WHEN** Jev answers after 300 ms in `observe` mode
- **THEN** the worker's first provider request is sent after the answer arrives, and its tools are unchanged

#### Scenario: Slow answer in enforce
- **WHEN** Jev answers after 300 ms in `enforce` mode and flags `edit`
- **THEN** the worker's first provider request is sent after the answer arrives, without `edit`

### Requirement: Flagging
A block candidate SHALL be flagged when its `tool::<name>` answer is a valid noul of at least 0.5. A candidate with a missing or invalid answer MUST NOT be flagged. Confidence MUST NOT affect flagging.

#### Scenario: Threshold boundary
- **WHEN** `tool::edit` is 0.5 and `tool::bash` is 0.49
- **THEN** `edit` is flagged and `bash` is not

#### Scenario: One bad answer
- **WHEN** `tool::edit` is 1.4 and `tool::bash` is 0.9
- **THEN** only `bash` is flagged

### Requirement: Observe and enforce
In `observe` mode (`tools.mode`, default `observe`), assessment MUST NOT change any tool. In `enforce` mode, the policy's adjustment SHALL carry flagged tools in `removeTools` and granted tools in `addTools`, so flagged tools are absent from the worker's provider requests and a call to one fails, and granted tools that take effect in the child (see `executor-launch-policy` "Grants are checked in the child") are offered and callable; other grants are dropped. Assessment MUST NOT add a tool that is not a grant candidate.

#### Scenario: Observe keeps tools
- **WHEN** in `observe` mode Jev flags `edit` and grants `web_search`
- **THEN** the worker's first provider request offers `edit` and does not offer `web_search`

#### Scenario: Enforce removes
- **WHEN** in `enforce` mode Jev flags `edit` for a worker
- **THEN** the worker's provider requests do not offer `edit`, and a call to `edit` returns an error result

#### Scenario: Enforce grants
- **WHEN** in `enforce` mode Jev grants `web_search` for a worker whose agent declares no `tools`, and the child registers `web_search` callable
- **THEN** the worker's first provider request offers `web_search`, and a call to it executes

#### Scenario: Enforce grant the child cannot take
- **WHEN** in `enforce` mode Jev grants a tool the child does not register
- **THEN** the worker starts without it, and `toolsGranted` does not count it

#### Scenario: Never adds
- **WHEN** Jev answers `grant::` for a tool name that is not a grant candidate
- **THEN** no tool is added to the worker

### Requirement: Once per worker
Assessment SHALL run once per launch, at its policy call. A resumed worker keeps the tools its session was created with, and MUST NOT be assessed again.

#### Scenario: Resumed worker
- **WHEN** an `enforce` worker that had `edit` flagged is resumed
- **THEN** no tool assessment request is sent and `edit` is still absent from its requests

#### Scenario: Failed first call not retried
- **WHEN** a launch's tool assessment request timed out and the worker is resumed
- **THEN** no tool assessment request is sent and the worker keeps every tool

### Requirement: Fail open
A Jev timeout, error, malformed response, or any error while assessing MUST leave the launch's tools unchanged (nothing removed, nothing granted) and record no counts. Nothing MUST be shown to the user.

#### Scenario: Jev down in enforce
- **WHEN** in `enforce` mode the tool assessment request is refused
- **THEN** the worker's first provider request offers exactly the tools it would have without the package

#### Scenario: Timeout
- **WHEN** Jev does not answer within `classifier.timeoutMs`
- **THEN** the worker starts with its default tools after the timeout

#### Scenario: Malformed response
- **WHEN** Jev returns a body without `answers`
- **THEN** no tool is removed or granted and no counts are recorded

### Requirement: Counts handed to the worker line
When a launch was assessed with an answer, the policy SHALL keep `toolsScored` (the number of scored candidates), `toolsFlagged` (the number flagged) and `toolsGranted` (in `enforce`, the number of grants the executor reported as taken effect in `grantedTools`; in `observe`, the number Jev would have granted) for that launch's `worker` line, keyed by its agent id. When no `worker` line is written for that launch, the counts MUST be recorded nowhere. The counts MUST NOT include tool names, the brief or any other text.

#### Scenario: Counts on the line
- **WHEN** a routed launch is assessed with 6 candidates, 1 flagged and 2 granted, and completes
- **THEN** its `worker` line has `toolsScored` 6, `toolsFlagged` 1 and `toolsGranted` 2

#### Scenario: No worker line
- **WHEN** the `subagents` switch is off and the `tools` switch is on and a launch is assessed
- **THEN** the ledger gains no line, and in `enforce` mode flagged tools are still removed and granted tools added

### Requirement: Grant question
For each grant candidate, the request SHALL ask one noul, key `grant::<name>`, with the wording in `docs/jev-questions.md`: whether the task needs that tool to be done well. It MUST NOT change the worker rubric version. A grant candidate SHALL be granted when its `grant::<name>` answer is a valid noul of at least `tools.grantAt` (default `0.8`). A missing or invalid answer MUST NOT grant. Confidence MUST NOT affect granting.

#### Scenario: Grant threshold boundary
- **WHEN** `tools.grantAt` is 0.8, `grant::web_search` is 0.8 and `grant::codemode` is 0.79
- **THEN** `web_search` is granted and `codemode` is not

#### Scenario: Rubric version unchanged
- **WHEN** the rubric version is read after this change
- **THEN** it is `2`

#### Scenario: Invalid grant answer
- **WHEN** `grant::web_search` is 1.2
- **THEN** `web_search` is not granted

### Requirement: Agent author's tools are never assessed
Tools in the agent's `tools` MUST NOT be candidates, and assessment MUST NOT remove them; they stay unless the executor itself withholds them (`disallowed_tools`, its recursion guard, or the child guard that hides `jev_review`). Tools in the agent's `disallowed_tools` MUST NOT be candidates and MUST NOT be granted. `jev_review`, `subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent` and `notify_parent` MUST NOT be candidates.

#### Scenario: Declared tools kept
- **WHEN** an agent declares `tools: read, edit` and the parent session also has `bash` and `web_search`
- **THEN** `read` and `edit` get no question, and `bash` and `web_search` are grant candidates

#### Scenario: Disallowed tool never offered
- **WHEN** an agent declares `disallowed_tools: web_search` and the parent session has `web_search`
- **THEN** the request has no question for `web_search`

#### Scenario: Orchestration and review tools excluded
- **WHEN** the agent declares `tools: none`, and the parent session has `subagent`, `jev_review` and `read`
- **THEN** the request scores exactly `read`, as a grant candidate
