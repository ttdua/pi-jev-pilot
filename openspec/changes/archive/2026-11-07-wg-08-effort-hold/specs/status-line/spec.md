## MODIFIED Requirements

### Requirement: Status line text
In a main session, the status line SHALL show the first that applies of: `Jev · config error` (config invalid), `Jev · no key` (key not set), `Jev · off` (all seven decision features `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review` off), and `Jev · <mode>` with the effective mode. When the text is `Jev · <mode>`, `effort` is on, and a main decision has been made in this session, it MUST be followed by ` · <level>` with the effective level of the latest applied, kept or held decision, or by ` · no answer` when the latest request was not held and was a miss (whatever was asked) or asked `effort` and left it unanswered. A held turn MUST show the level in force, whether or not Jev answered. A discarded or cancelled decision, and an answered request that did not ask `effort` and was not held, MUST leave the suffix as it was. A session start MUST clear the suffix. Drawing the line MUST make no network call.

#### Scenario: Ready with the default mode
- **WHEN** the config is valid, the key is set, no switch is changed and no mode is set
- **THEN** the status line reads `Jev · standard`

#### Scenario: Mode from state
- **WHEN** the key is set and `state.json` sets the mode to `premium`
- **THEN** the status line reads `Jev · premium`

#### Scenario: No key
- **WHEN** the config is valid and the environment variable named by `classifier.apiKeyEnv` is unset or empty
- **THEN** the status line reads `Jev · no key`

#### Scenario: Config error wins over no key
- **WHEN** `config.json` is invalid and the key is unset
- **THEN** the status line reads `Jev · config error`

#### Scenario: Everything off
- **WHEN** the config is valid, the key is set and all seven decision features are off
- **THEN** the status line reads `Jev · off`

#### Scenario: One feature off is not off
- **WHEN** the key is set and only `skills` is off
- **THEN** the status line reads `Jev · standard`

#### Scenario: No executor is not shown
- **WHEN** the config is valid, the key is set and no installed extension registers a `subagent` tool
- **THEN** the status line reads `Jev · standard`

#### Scenario: Malformed state uses defaults
- **WHEN** the key is set and `state.json` is malformed
- **THEN** the status line reads `Jev · standard`

#### Scenario: After a decision
- **WHEN** a main decision applied `high`
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: After a miss
- **WHEN** the latest main request was not held and timed out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Discarded keeps the previous suffix
- **WHEN** the previous decision showed `high` and the next result is discarded
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Miss on a non-reasoning model
- **WHEN** the model is not a reasoning model and the request asking only `corrects` times out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Answered without effort keeps the suffix
- **WHEN** the previous decision showed `high` and an answered request on a non-reasoning model asked only `corrects`
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Held turn shows the level in force
- **WHEN** a session resumed on a listed provider with an anchor at `high`, with no suffix yet, and the next prompt is held
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Held miss shows the level
- **WHEN** a prompt is held at `high` and its Jev request times out
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Kept across /jev
- **WHEN** a decision applied `high` and the operator runs `/jev skills off`
- **THEN** the redrawn status line reads `Jev · standard · high`

#### Scenario: Effort switched off
- **WHEN** a decision applied `high` and the operator runs `/jev effort off`
- **THEN** the redrawn status line reads `Jev · standard`

#### Scenario: Session start clears the suffix
- **WHEN** a decision applied `high` and the operator starts a new session
- **THEN** the status line reads `Jev · standard`

#### Scenario: Base state wins
- **WHEN** a decision applied `high` and the operator then runs `/jev all off`
- **THEN** the status line reads `Jev · off`
