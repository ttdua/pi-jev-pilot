# tool-assessment Specification

## Purpose
When a worker's tools are assessed, how the worker finds its launch, the request and its candidates, the threshold, `observe` and `enforce`, reuse across turns, and failing open.

## Requirements

### Requirement: When assessment runs
Tool assessment SHALL run only in a child (worker) session, at its first `before_agent_start`, with conditions read fresh there. It MUST do nothing, and call Jev for nothing, when the session is not a child, `config.json` is invalid, the API key is unset, the `tools` switch is off, or no executor service was captured from the main session. Doing nothing MUST leave the worker's selected tools exactly as without assessment.

#### Scenario: Switch off
- **WHEN** the `tools` switch is off and a worker whose agent declares no `tools` starts
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: No key
- **WHEN** the API key is unset and a worker starts
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and a worker starts
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Main session
- **WHEN** a prompt starts in the main session
- **THEN** no tool assessment request is sent

#### Scenario: Executor absent
- **WHEN** the executor is not installed and a prompt starts
- **THEN** no tool assessment request is sent

#### Scenario: Mode read once
- **WHEN** `tools.mode` changes from `observe` to `enforce` while a worker runs
- **THEN** that worker keeps the mode read at its first `before_agent_start`

### Requirement: Worker finds its launch
The worker SHALL find its executor record by matching its session file with `outputFile` in `listAgents()` of the executor service captured by the main session at its `session_start`, never the service currently on `globalThis`. It SHALL take the agent id, type and description from the record, and read the agent's facts from the type as worker routing does. No match, several matches, or a lookup error MUST mean no assessment and every tool kept.

#### Scenario: Record found
- **WHEN** a worker of agent `general-purpose` with description `probe` starts
- **THEN** the tool assessment request's `agent.name` is `general-purpose` and `task.description` is `probe`

#### Scenario: Concurrent workers
- **WHEN** two background workers of different agents start at the same time
- **THEN** each tool assessment request names its own worker's agent

#### Scenario: No record
- **WHEN** no record's `outputFile` matches the worker's session file
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Lookup throws
- **WHEN** `listAgents()` throws
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Several records match
- **WHEN** two records have the worker's session file as `outputFile`
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

### Requirement: Captured executor service
The main session SHALL capture the executor service from `globalThis` at each of its `session_start` handlers, replacing any earlier capture, and SHALL clear it at its `session_shutdown`. A child session's `session_start` MUST NOT capture or clear it.

#### Scenario: Child's own service ignored
- **WHEN** a child's executor instance has published its own, empty service on `globalThis` and the worker starts
- **THEN** the worker's record is found through the service captured by the main session

#### Scenario: New main session
- **WHEN** the main session starts again after a reload
- **THEN** workers launched afterwards are looked up through the newly captured service

#### Scenario: Main session shut down
- **WHEN** the main session has shut down and a worker's first `before_agent_start` runs
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

### Requirement: Only agents that declare no tools
Assessment SHALL run only when the worker's agent declares no `tools`, with the agent's facts resolved as worker routing resolves them (an unknown agent name resolves to `general-purpose`). An agent with a `tools` field, even an empty one, MUST NOT be assessed.

#### Scenario: Declared tools
- **WHEN** a worker of the built-in `Explore` agent starts
- **THEN** no tool assessment request is sent

#### Scenario: Agent file without tools
- **WHEN** a worker of a project agent file with no `tools` field starts
- **THEN** one tool assessment request is sent

#### Scenario: Empty tools list
- **WHEN** a worker's agent file has `tools: []`
- **THEN** no tool assessment request is sent

### Requirement: Candidates
The candidates SHALL be the worker's selected tools at its first `before_agent_start`, after `jev_review` is removed, in their order, except `ask_parent` and `notify_parent`. At most the first 32 candidates SHALL be scored; the others MUST stay allowed. With no candidate, no request is sent.

#### Scenario: Protocol tools never candidates
- **WHEN** a worker's selected tools are `read`, `bash`, `ask_parent` and `notify_parent`
- **THEN** the request scores exactly `read` and `bash`

#### Scenario: Review tool never a candidate
- **WHEN** a worker starts and `jev_review` is registered
- **THEN** the request has no question for `jev_review`

#### Scenario: Cap at 32
- **WHEN** a worker has 40 candidates
- **THEN** the request scores the first 32, and the other 8 are kept in every mode

### Requirement: Assessment request
The request SHALL carry `task` (brief and description), `agent` (name, source, description) and `tools` keyed by candidate name with the description, source and top-level parameter descriptions from `pi.getAllTools()`, each description cut to 500 code points. It SHALL ask one noul per candidate, key `tool::<name>`, with the wording in `docs/jev-questions.md`. It MUST NOT contain tool arguments, tool output, or any model or thinking setting.

#### Scenario: One noul per candidate
- **WHEN** the candidates are `read`, `edit` and `bash`
- **THEN** the request has exactly the questions `tool::read`, `tool::edit` and `tool::bash`, each of type noul

#### Scenario: Tool metadata from Pi
- **WHEN** `bash` is a candidate
- **THEN** `tools.bash` has the description Pi reports for `bash` and its `command` parameter description

#### Scenario: Long tool description
- **WHEN** a candidate's description is 900 code points
- **THEN** its `description` in the request is the first 500 code points

### Requirement: Brief
The brief SHALL be the last 4000 code points of the worker's first prompt, because the executor puts any inherited parent context before the brief and the worker cannot tell the two apart. A first run not started by a user prompt, or an empty prompt, MUST mean no request. The brief MUST be sent only, never stored.

#### Scenario: Long brief
- **WHEN** a worker's first prompt is 5000 code points
- **THEN** `task.brief` is its last 4000 code points

#### Scenario: Forked worker
- **WHEN** a worker inherits context and its first prompt is the parent context followed by the brief
- **THEN** `task.brief` ends with the brief

#### Scenario: Empty prompt
- **WHEN** a worker's first prompt is empty
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Brief not stored
- **WHEN** a worker with a brief containing a unique marker is assessed
- **THEN** no ledger file contains that marker

### Requirement: The worker waits for the answer
The worker's first turn SHALL wait for the tool assessment answer in both `observe` and `enforce`, bounded by `classifier.timeoutMs`.

#### Scenario: Slow answer in observe
- **WHEN** Jev answers after 300 ms in `observe` mode
- **THEN** the worker's first provider request is sent after the answer arrives, and its tools are unchanged

#### Scenario: Slow answer in enforce
- **WHEN** Jev answers after 300 ms in `enforce` mode and flags `edit`
- **THEN** the worker's first provider request is sent after the answer arrives, without `edit`

### Requirement: Flagging
A candidate SHALL be flagged when its `tool::<name>` answer is a valid noul of at least 0.5. A candidate with a missing or invalid answer MUST NOT be flagged. Confidence MUST NOT affect flagging.

#### Scenario: Threshold boundary
- **WHEN** `tool::edit` is 0.5 and `tool::bash` is 0.49
- **THEN** `edit` is flagged and `bash` is not

#### Scenario: One bad answer
- **WHEN** `tool::edit` is 1.4 and `tool::bash` is 0.9
- **THEN** only `bash` is flagged

### Requirement: Observe and enforce
In `observe` mode (`tools.mode`, default `observe`), assessment MUST NOT remove any tool. In `enforce` mode, flagged tools SHALL be removed from the worker's `systemPromptOptions.selectedTools`, so they are absent from its provider requests and a call to one fails. Assessment MUST NOT add a tool.

#### Scenario: Observe keeps tools
- **WHEN** in `observe` mode Jev flags `edit` for a worker
- **THEN** the worker's first provider request still offers `edit`

#### Scenario: Enforce removes
- **WHEN** in `enforce` mode Jev flags `edit` for a worker
- **THEN** the worker's provider requests do not offer `edit`, and a call to `edit` returns an error result

#### Scenario: Never adds
- **WHEN** Jev answers for a tool name that is not a candidate
- **THEN** no tool is added to the worker

### Requirement: Once per worker
Assessment SHALL run once per worker session; a resumed launch runs in the same session. Every later `before_agent_start` of that session MUST send no request and, when the mode read at the first call was `enforce`, SHALL remove the same flagged tools again. A first call that sent no request or got no answer MUST NOT be retried.

#### Scenario: Resumed worker
- **WHEN** an `enforce` worker that had `edit` flagged is resumed
- **THEN** no tool assessment request is sent and `edit` is still absent from its requests

#### Scenario: Failed first call not retried
- **WHEN** a worker's tool assessment request timed out and the worker is resumed
- **THEN** no tool assessment request is sent and the worker keeps every tool

### Requirement: Fail open
A Jev timeout, error, malformed response, or any error while assessing MUST leave every tool in place and record no counts. Nothing MUST be shown to the user.

#### Scenario: Jev down in enforce
- **WHEN** in `enforce` mode the tool assessment request is refused
- **THEN** the worker's first provider request offers every tool it would have without the package

#### Scenario: Timeout
- **WHEN** Jev does not answer within `classifier.timeoutMs`
- **THEN** the worker starts with every tool after the timeout

#### Scenario: Malformed response
- **WHEN** Jev returns a body without `answers`
- **THEN** no tool is removed and no counts are recorded

### Requirement: Counts handed to the worker line
When a worker's first `before_agent_start` was assessed with an answer, the worker session SHALL hand `toolsScored` (the number of scored candidates) and `toolsFlagged` (the number flagged, in either mode) to the main session, keyed by the executor agent id. When no `worker` ledger line is written for that launch, the counts MUST be recorded nowhere. The handed-over counts MUST NOT include tool names, the brief or any other text.

#### Scenario: Counts on the line
- **WHEN** a routed worker is assessed with 5 candidates, 2 of them flagged, and completes
- **THEN** its `worker` line has `toolsScored` 5 and `toolsFlagged` 2

#### Scenario: No worker line
- **WHEN** the `subagents` switch is off and the `tools` switch is on and a worker is assessed
- **THEN** the ledger gains no line, and in `enforce` mode flagged tools are still removed
