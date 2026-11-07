## MODIFIED Requirements

### Requirement: Minimal main state
The `state` of a main request SHALL have exactly `request`, `conversation` and `workspace`. By default, `conversation` MUST have exactly `recent`, `recent_tools` and `turn_index`, and `workspace` MUST have exactly `platforms`. A rich field group (`last_decision`, `context_used_percent`, `git`, `languages`, `capabilities`) MUST be sent only when it is listed in the shipped groups constant. When the constant is empty, the state MUST be the minimal one. The current model and thinking level, diffs and file contents MUST NOT be sent. The state MUST be built by a module with no Pi import, from plain inputs.

#### Scenario: Field set
- **WHEN** a main request is sent and no rich group is shipped
- **THEN** its `state` keys are exactly `request`, `conversation`, `workspace`, with `conversation` keys `recent`, `recent_tools`, `turn_index` and `workspace` keys `platforms`

#### Scenario: Rich inputs ignored unless shipped
- **WHEN** a host test runs with no rich group shipped, in a git repository with changes and with an earlier answered turn
- **THEN** the recorded provider-side Jev request carries none of `last_decision`, `context_used_percent`, `git`, `languages`, `capabilities`

## ADDED Requirements

### Requirement: Rich field groups
`mainState` SHALL accept an optional input for each rich group and add the group only when its input is given. The groups MUST be placed as follows:
- `last_decision` and `context_used_percent` go under `conversation`;
- `git` and `languages` go under `workspace`;
- `capabilities` goes at the top level.

Giving every input MUST produce the full state shown in `docs/jev-contract.md`.

#### Scenario: One group alone
- **WHEN** `mainState` gets only the `languages` input `["TypeScript"]`
- **THEN** the state is the minimal state plus `workspace.languages` `["TypeScript"]`, and nothing else

#### Scenario: Every group
- **WHEN** `mainState` gets all five inputs
- **THEN** `conversation` has `last_decision` and `context_used_percent`, `workspace` has `git` and `languages`, and `capabilities` has `tools` and `subagents`

### Requirement: Last decision and context percentage
`last_decision` SHALL be `{ effort, strategy }` from the previous answered main turn in the session, with a key omitted when that turn decided none. The field MUST be omitted on the first turn, and when no previous decision is known. `context_used_percent` SHALL be the context percentage rounded to an integer from 0 to 100. It MUST be omitted when the percentage is unknown.

#### Scenario: Previous turn known
- **WHEN** the previous turn applied `high` and Jev chose strategy `direct`
- **THEN** `last_decision` is `{ effort: "high", strategy: "direct" }`

#### Scenario: Unknown context
- **WHEN** the context percentage is unknown, as right after compaction
- **THEN** `context_used_percent` is absent

#### Scenario: Rounded percentage
- **WHEN** the context percentage is 33.6
- **THEN** `context_used_percent` is 34

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

### Requirement: Languages
`workspace.languages` SHALL list at most 5 language names, most files first, with ties broken by name. The names MUST be read from file names only, at most 3 levels below the working directory and at most 5000 entries, skipping symlinks and the directories the platform scan skips. A language MUST have at least 3 files and at least 5% of the recognised files. With none qualifying, the value MUST be `["none found"]`. An unreadable directory MUST be skipped without failing.

#### Scenario: Ranked languages
- **WHEN** the tree holds 10 `.ts` files, 4 `.py` files and 1 `.go` file
- **THEN** `languages` is `["TypeScript", "Python"]`

#### Scenario: Skipped directory
- **WHEN** the only source files are under `node_modules/`
- **THEN** `languages` is `["none found"]`

#### Scenario: Too deep
- **WHEN** the only source files are 4 levels below the working directory
- **THEN** `languages` is `["none found"]`

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
