## MODIFIED Requirements

### Requirement: Minimal main state
The `state` of a main request SHALL have exactly `request`, `conversation` and `workspace`, plus `capabilities` once that group is shipped. `conversation` MUST have `recent`, `recent_tools` and `turn_index`, plus `last_decision` when that group is shipped and a previous decision is known. `workspace` MUST have `platforms`, plus `git` only if that group is shipped. A rich field group (`last_decision`, `git`, `capabilities`) MUST be sent only when it is listed in the shipped groups constant. The shipped groups SHALL be `last_decision` and `capabilities`, decided by the WG-16 pass 1 replay; `git` awaits pass 2. `context_used_percent` and `languages` MUST NOT be sent. The current model and thinking level, diffs and file contents MUST NOT be sent. The state MUST be built by a module with no Pi import, from plain inputs.

#### Scenario: Field set
- **WHEN** a main request is sent on the second answered turn of a session
- **THEN** its `state` keys are exactly `request`, `conversation`, `workspace`, `capabilities`, with `conversation` keys `recent`, `recent_tools`, `turn_index`, `last_decision` and `workspace` keys `platforms`

#### Scenario: First turn has no last decision
- **WHEN** a main request is sent on the first turn of a session
- **THEN** `conversation` has no `last_decision` key, and `capabilities` is present

#### Scenario: Unshipped groups never sent
- **WHEN** a host test runs in a git repository with changes, with an earlier answered turn
- **THEN** the recorded provider-side Jev request carries none of `context_used_percent`, `git`, `languages`

## ADDED Requirements

### Requirement: Rich field groups
`mainState` SHALL accept an optional input for each rich group and add the group only when its input is given. The groups MUST be placed as follows:
- `last_decision` goes under `conversation`;
- `git` goes under `workspace`;
- `capabilities` goes at the top level.

#### Scenario: One group alone
- **WHEN** `mainState` gets only the `last_decision` input `{ effort: "high" }`
- **THEN** the state is the minimal state plus `conversation.last_decision` `{ effort: "high" }`, and nothing else

#### Scenario: Every group
- **WHEN** `mainState` gets all three inputs
- **THEN** `conversation` has `last_decision`, `workspace` has `git`, and `capabilities` has `tools` and `subagents`

### Requirement: Last decision
`last_decision` SHALL be `{ effort, strategy }` from the previous answered main turn in the session, with a key omitted when that turn decided none. The field MUST be omitted on the first turn, and when no previous decision is known.

#### Scenario: Previous turn known
- **WHEN** the previous turn applied `high` and Jev chose strategy `direct`
- **THEN** `last_decision` is `{ effort: "high", strategy: "direct" }`

### Requirement: Git counts
`workspace.git` SHALL be `{ changed_files, diff_lines }`, parsed from `git diff HEAD --shortstat` output. `diff_lines` MUST be insertions plus deletions, and a missing number MUST count as 0. Empty output MUST give `{ changed_files: 0, diff_lines: 0 }`. Output that cannot be parsed, a directory that is not a repository, a failed command, or a run past 500 ms MUST omit the field without failing the request.

#### Scenario: Shortstat parsed
- **WHEN** the output is ` 3 files changed, 70 insertions(+), 14 deletions(-)`
- **THEN** `git` is `{ changed_files: 3, diff_lines: 84 }`

#### Scenario: Insertions only
- **WHEN** the output is ` 1 file changed, 5 insertions(+)`
- **THEN** `git` is `{ changed_files: 1, diff_lines: 5 }`

#### Scenario: Not a repository
- **WHEN** the git command fails
- **THEN** `workspace.git` is absent and the request is still sent

### Requirement: Capabilities
`capabilities.tools` SHALL list the active tools in name order, at most 40, each as `{ name, summary }`. `summary` MUST be the first sentence of the description, at most 200 code points. `capabilities.subagents` SHALL list the available agents in name order, at most 30, each as `{ name, description, tools }`, with `description` cut to 200 code points. An agent's `model` and `thinking` MUST NOT be sent.

#### Scenario: First sentence
- **WHEN** a tool's description is `Read a file. Supports images.`
- **THEN** its `summary` is `Read a file.`

#### Scenario: Caps
- **WHEN** 50 tools are active
- **THEN** `capabilities.tools` has the first 40 by name

#### Scenario: Agent caps
- **WHEN** 35 agents are available and one has a 300-code-point description
- **THEN** `capabilities.subagents` has the first 30 by name, and that description, if among them, has 200 code points
