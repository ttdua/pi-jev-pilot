## MODIFIED Requirements

### Requirement: Brief
The brief SHALL be the last 4000 code points of the launch request's `prompt`. An empty prompt MUST mean no request. The brief MUST be sent only, never stored. Fork launches carry the brief without the inherited conversation.

#### Scenario: Long brief
- **WHEN** a launch's prompt is 5000 code points
- **THEN** `task.brief` is its last 4000 code points

#### Scenario: Forked worker
- **WHEN** a launch's context is `fork`
- **THEN** `task.brief` is the launch's own prompt, without the parent's conversation

#### Scenario: Empty prompt
- **WHEN** a launch's prompt is empty
- **THEN** no tool assessment request is sent and the worker's tools are unchanged

#### Scenario: Brief not stored
- **WHEN** a launch with a brief containing a unique marker is assessed
- **THEN** no ledger file contains that marker

### Requirement: Observe and enforce
In `observe` mode (`tools.mode`, default `observe`), assessment MUST NOT change any tool. In `enforce` mode, the policy's adjustment SHALL carry flagged tools in `removeTools` and granted tools in `addTools`, so flagged tools are absent from the worker's provider requests and a call to one fails, and granted tools that take effect in the child (see `executor-launch-policy` "Grants are checked in the child") are offered and callable; other grants are dropped. Assessment MUST NOT add a tool that is not a grant candidate. For a fork worker, a flagged tool stays offered and a call to it is refused (see `subagent-context-mode`).

#### Scenario: Observe keeps tools
- **WHEN** in `observe` mode Jev flags `edit` and grants `web_search` for a fresh worker
- **THEN** the worker's first provider request offers `edit` and does not offer `web_search`

#### Scenario: Observe in a fork
- **WHEN** in `observe` mode Jev flags `edit` and grants `web_search` for a fork of a read-only agent whose parent has both
- **THEN** the fork's first request offers both, a call to `edit` is refused by the agent's allowlist, and a call to `web_search` is refused because the grant was not applied

#### Scenario: Enforce removes
- **WHEN** in `enforce` mode Jev flags `edit` for a fresh worker
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

#### Scenario: Enforce in a fork
- **WHEN** in `enforce` mode Jev flags `edit` for a fork worker
- **THEN** the fork's provider requests still offer `edit`, and a call to `edit` is refused

### Requirement: Once per worker
Assessment SHALL run once per launch, at its policy call. A resumed worker keeps the tools its session was created with, and MUST NOT be assessed again. A resumed fork keeps the same declarations and the same refused tools.

#### Scenario: Resumed worker
- **WHEN** an `enforce` fresh worker that had `edit` flagged is resumed
- **THEN** no tool assessment request is sent and `edit` is still absent from its requests

#### Scenario: Failed first call not retried
- **WHEN** a launch's tool assessment request timed out and the worker is resumed
- **THEN** no tool assessment request is sent and the worker keeps every tool

#### Scenario: Resumed fork keeps refusals
- **WHEN** an `enforce` fork worker that had `edit` flagged is resumed
- **THEN** no tool assessment request is sent, `edit` is still offered, and a call to `edit` is still refused
