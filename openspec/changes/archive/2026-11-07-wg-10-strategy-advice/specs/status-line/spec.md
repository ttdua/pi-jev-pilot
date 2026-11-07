## MODIFIED Requirements

### Requirement: Status line text
In a main session, the status line SHALL show the first that applies of: `Jev · config error` (config invalid), `Jev · no key` (key not set), `Jev · off` (all seven decision features `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review` off), and `Jev · <mode>` with the effective mode.

When the text is `Jev · <mode>`, suffixes follow in this order:
- **Effort suffix.** When `effort` is on and a main decision has been made in this session, ` · <level>` MUST follow, with the effective level of the latest applied or kept decision. ` · no answer` MUST follow instead when the latest request was a miss (whatever was asked), or asked `effort` and left it unanswered. A discarded or cancelled decision, and an answered request that did not ask `effort`, MUST leave this suffix as it was.
- **Advice suffix.** When `strategy` is on and the latest decided request that asked `strategy` attached advice, ` · <strategy>` MUST follow, with the attached strategy. A later decided request that asked `strategy` and attached none, or a miss, MUST remove it. A request that did not ask `strategy` MUST leave it as it was. A discarded effort result MUST NOT affect it. A cancelled decision MUST leave both suffixes as they were. While `strategy` is off the advice suffix MUST NOT be shown; turning `strategy` back on shows the latest kept advice again, as the effort suffix does for `effort`.

A session start MUST clear both suffixes. Drawing the line MUST make no network call.

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
- **WHEN** a main decision applied `high` and attached no advice
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: After a decision with advice
- **WHEN** a main decision applied `high` and attached advice for `delegate`
- **THEN** the status line reads `Jev · standard · high · delegate`

#### Scenario: Advice with effort off
- **WHEN** `effort` is off and a main decision attached advice for `parallel`
- **THEN** the status line reads `Jev · standard · parallel`

#### Scenario: Advice cleared by the next turn
- **WHEN** the previous decision showed `high · delegate` and the next decision applied `medium` and attached no advice
- **THEN** the status line reads `Jev · standard · medium`

#### Scenario: Strategy switched off
- **WHEN** a decision showed `high · delegate` and the operator runs `/jev strategy off`
- **THEN** the redrawn status line reads `Jev · standard · high`

#### Scenario: Discarded effort with advice
- **WHEN** the previous decision showed `high`, and the next result is discarded on a manual change and attached advice for `delegate`
- **THEN** the status line reads `Jev · standard · high · delegate`

#### Scenario: Strategy switched back on
- **WHEN** a decision showed `high · delegate`, and the operator runs `/jev strategy off` then `/jev strategy on`
- **THEN** the redrawn status line reads `Jev · standard · high · delegate`

#### Scenario: After a miss
- **WHEN** the latest main request timed out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Discarded keeps the previous suffix
- **WHEN** the previous decision showed `high` and the next result is discarded and attached no advice
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Miss on a non-reasoning model
- **WHEN** the model is not a reasoning model, `strategy` is off, and the request asking only `corrects` times out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Answered without effort keeps the suffix
- **WHEN** the previous decision showed `high`, `strategy` is off, and an answered request on a non-reasoning model asked only `corrects`
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Kept across /jev
- **WHEN** a decision applied `high` and the operator runs `/jev skills off`
- **THEN** the redrawn status line reads `Jev · standard · high`

#### Scenario: Effort switched off
- **WHEN** a decision applied `high`, attached no advice, and the operator runs `/jev effort off`
- **THEN** the redrawn status line reads `Jev · standard`

#### Scenario: Session start clears the suffix
- **WHEN** a decision showed `high · delegate` and the operator starts a new session
- **THEN** the status line reads `Jev · standard`

#### Scenario: Base state wins
- **WHEN** a decision applied `high` and the operator then runs `/jev all off`
- **THEN** the status line reads `Jev · off`

#### Scenario: Cancelled keeps both suffixes
- **WHEN** the previous decision showed `high · delegate` and the operator aborts the next prompt before any provider request
- **THEN** the status line reads `Jev · standard · high · delegate`
