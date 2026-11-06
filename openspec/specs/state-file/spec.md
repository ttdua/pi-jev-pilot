# state-file Specification

## Purpose
`state.json` holds the switches, mode and CLI review default set through `/jev`, written atomically, falling back to defaults when missing or malformed and never discarding a file that cannot be read.

## Requirements

### Requirement: State file content
`state.json` SHALL hold `version` `1` and the optional fields `switches` (feature name to boolean), `mode` (`budget`, `standard` or `premium`) and `cliReview` (required `cli` of `codex` or `opencode`; optional `model` and `effort` of 1–64 characters from letters, digits, `.`, `_`, `-`, other than the word `default`, which the `/jev cli-review` command expresses by omitting the field). The features are those in `docs/usage-guide.md`. A field MUST be present only when the operator set it.

#### Scenario: Valid state read
- **WHEN** `state.json` holds `{"version":1,"switches":{"skills":false},"mode":"budget","cliReview":{"cli":"codex","model":"luna","effort":"high"}}`
- **THEN** the read returns those values

#### Scenario: Every documented feature accepted
- **WHEN** `state.json` sets each of `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`, `status`, `verbose` to `false`
- **THEN** the read returns all nine switches off

#### Scenario: Literal default rejected
- **WHEN** `cliReview.model` is `"default"`
- **THEN** the read is malformed with a problem at `cliReview.model`

#### Scenario: Unknown feature
- **WHEN** `state.json` has `switches.colors`
- **THEN** the read is malformed with a problem at `switches.colors`

### Requirement: Missing state means defaults
A missing `state.json` SHALL read as missing, with no fields set, and MUST NOT be reported as a problem.

#### Scenario: No file
- **WHEN** the jev directory has no `state.json`
- **THEN** the read is missing, with no switches, mode or CLI review default

### Requirement: Malformed state falls back to defaults
A `state.json` that is not valid JSON, is not an object, has a `version` other than `1`, has an unknown key or has a wrong value SHALL read as malformed, with no fields set and the list of problems, so the caller can use defaults and warn. A malformed file MUST NOT make the package inert, and no field MUST be salvaged from it. Problem messages MUST NOT include the value found.

#### Scenario: Bad JSON
- **WHEN** `state.json` is truncated
- **THEN** the read is malformed with a problem at `""` and no fields set

#### Scenario: Partly valid file is not salvaged
- **WHEN** `state.json` has a valid `mode` and an invalid `switches.skills` value
- **THEN** the read is malformed and the mode is not returned

#### Scenario: Future version
- **WHEN** `state.json` has `version` `2`
- **THEN** the read is malformed with a problem at `version`

### Requirement: Unreadable state is not discarded
A `state.json` that exists but cannot be read (for example `EACCES`, or a directory in its place) SHALL read as unreadable, with no fields set and a problem at `""` naming the error code. An update or reset MUST then refuse with that problem, without renaming or replacing the file.

#### Scenario: Permission denied
- **WHEN** `state.json` has mode `0000` and an update runs
- **THEN** the read is unreadable naming `EACCES`, the update returns that problem, and no `state.json.bad` is created

### Requirement: State updates are atomic and recover a bad file
Updating the state SHALL read the current file, apply the change, validate the result and write it atomically. If the current file is malformed, the update MUST first rename it to `state.json.bad` with mode `0600`, replacing any older `.bad` file, and start from an empty state. An update whose result is invalid MUST be refused and leave the file unchanged.

#### Scenario: Switch persists
- **WHEN** an update turns `skills` off
- **THEN** a new read returns `switches.skills` as `false`, and the other fields as before

#### Scenario: Bad file moved aside
- **WHEN** `state.json` is malformed and an update sets `mode` to `premium`
- **THEN** the old bytes are in `state.json.bad` with mode `0600`, and `state.json` holds only `version` and `mode`

#### Scenario: Invalid update refused
- **WHEN** an update sets `mode` to `"turbo"`
- **THEN** the update returns a problem at `mode` and `state.json` is unchanged

### Requirement: Reset
Resetting the state SHALL write a state with no fields set, so every switch, the mode and the CLI review default fall back to their config or code defaults.

#### Scenario: Reset clears everything
- **WHEN** the state has switches, a mode and a CLI review default, and it is reset
- **THEN** a new read returns no switches, no mode and no CLI review default
