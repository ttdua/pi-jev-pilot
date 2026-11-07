## ADDED Requirements

### Requirement: CLI review on or off
The CLI review SHALL be on or off, as resolved under `settings-resolution` (state, else config, else off). While it is off, `jev_review` MUST be absent from every main-session provider request, along with its prompt snippet and guideline. While it is on, it SHALL be offered and run in the main session. A change through `/jev` SHALL apply from the next main turn without a restart. Toggling MUST change no other active tool.

#### Scenario: Off by default
- **WHEN** neither the state nor the config sets the CLI review, the package is loaded in a main session, and the first provider request is sent
- **THEN** the request has no tool named `jev_review`, and its body does not contain `jev_review`

#### Scenario: On from the config
- **WHEN** the config sets `review.enabled` to `true`, the state does not set it, and the first main provider request is sent
- **THEN** the request's tools include `jev_review`

#### Scenario: State off over config on
- **WHEN** the config sets `review.enabled` to `true`, the state holds `cliReviewEnabled` `false`, and the first main provider request is sent
- **THEN** the request has no tool named `jev_review`

#### Scenario: Turned on mid-session
- **WHEN** the CLI review is off, a main turn has run, the operator runs `/jev cli-review on`, and a new prompt is sent
- **THEN** the new turn's first provider request includes `jev_review`

#### Scenario: Turned off mid-session
- **WHEN** the CLI review is on, a main turn has run, the operator runs `/jev cli-review off`, and a new prompt is sent
- **THEN** the new turn's first provider request has no tool named `jev_review`

#### Scenario: Other tools untouched
- **WHEN** the active tools are `read`, `jev_review` and `bash`, and the CLI review is turned off
- **THEN** the active tools become `read` and `bash`, in that order

### Requirement: Refused while off
If `jev_review` executes while the CLI review is off, it MUST return an error result saying `jev_review is off` and naming `/jev cli-review on`, and MUST run no process. When the setting cannot be read, the CLI review MUST count as off.

#### Scenario: Refused while off
- **WHEN** the CLI review is off and `jev_review` executes in the main session
- **THEN** it returns an error result saying `jev_review is off` and naming `/jev cli-review on`, and runs no process

#### Scenario: Unreadable setting counts as off
- **WHEN** loading the settings throws and `jev_review` executes in the main session
- **THEN** it returns the off error result and runs no process

## MODIFIED Requirements

### Requirement: Independent of Jev and switches
`jev_review` MUST NOT call Jev. While the CLI review is on, it SHALL stay offered and run whether or not the API key is set, whatever the feature switches say, and when `config.json` is invalid. With an invalid config, the config contributes nothing: the reviewer defaults to `codex` unless the state sets one, and the CLI review is on only if the state turns it on. `/jev all on|off` MUST NOT change the CLI review.

#### Scenario: No key, review switch off
<!-- Intentional change: the `review` feature switch is removed; the scenario keeps its name and now turns every feature switch off. -->
- **WHEN** the CLI review is on, the API key is not set, every feature switch is off, and `jev_review` is called with a brief
- **THEN** the CLI runs and no request reaches Jev

#### Scenario: Invalid config, on from state
- **WHEN** `config.json` is invalid, the state holds `cliReviewEnabled` `true`, and `jev_review` is called with a brief
- **THEN** `codex` runs

### Requirement: Review tool in the main session only
In a child session `jev_review` MUST be removed from the session's selected tools before the child's first provider request, whatever the CLI review setting. If it is called in a child session anyway, it MUST return an error result without running any process.

#### Scenario: Offered in the main session
- **WHEN** the CLI review is on, the package is loaded in a main session, and the first provider request is sent
- **THEN** the request's tools include `jev_review`

#### Scenario: Absent in a child session
- **WHEN** the CLI review is on and the executor starts a child session with the package loaded
- **THEN** the child's first provider request has no tool named `jev_review`

#### Scenario: Refused in a child session
- **WHEN** `jev_review` executes with a session id the child registry holds
- **THEN** it returns an error result and runs no process
