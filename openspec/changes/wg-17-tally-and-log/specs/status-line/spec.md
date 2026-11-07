## MODIFIED Requirements

### Requirement: Status line text
In a main session, the status line SHALL show the first that applies of: `Jev · config error` (config invalid), `Jev · no key` (key not set), `Jev · off` (all seven decision features `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review` off), and `Jev · <mode>` with the effective mode. When the text is `Jev · <mode>`, `effort` is on, and a main decision has been made in this session, it MUST be followed by ` · <level>` with the effective level of the latest applied, kept or held decision, or by ` · no answer` when the latest request was not held and was a miss (whatever was asked) or asked `effort` and left it unanswered. A held turn MUST show the level in force, whether or not Jev answered. A discarded or cancelled decision, and an answered request that did not ask `effort` and was not held, MUST leave the suffix as it was. When an eligible prompt's Jev request completes (answered, missed or held, not cancelled) while the session tally counts a number of prompts one short of a multiple of 10 (so this prompt is the 10th, 20th, ...), the suffix MUST read ` · <P> prompts · <W> workers · <F> fallbacks` instead, with `P` the tally's prompts plus one and `W`, `F` the tally's workers and fallbacks, whether or not the result changed the level suffix. The tally form MUST last only until the next eligible prompt starts, which then shows the level suffix as the rules above set it. Prompts with `effort` off are not eligible, so they never show the tally form. A session start MUST clear the suffix. Drawing the line MUST make no network call.

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

#### Scenario: Tally on the 10th prompt
- **WHEN** nine decided prompts have settled, two workers were recorded, one of them a fallback, and the 10th prompt's decision applies `high`
- **THEN** the status line reads `Jev · standard · 10 prompts · 2 workers · 1 fallbacks`

#### Scenario: Ninth prompt shows the level
- **WHEN** eight decided prompts have settled and the 9th prompt's decision applies `high`
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Eleventh prompt shows the level again
- **WHEN** the 10th prompt showed the tally and the 11th prompt's decision applies `medium`
- **THEN** the status line reads `Jev · standard · medium`

#### Scenario: Tally kept across /jev
- **WHEN** the 10th prompt showed the tally and the operator runs `/jev skills off`
- **THEN** the redrawn status line still shows the tally form

#### Scenario: Tally on a miss
- **WHEN** nine decided prompts have settled and the 10th prompt's Jev request times out
- **THEN** the status line reads `Jev · standard · 10 prompts · 0 workers · 0 fallbacks`

#### Scenario: Tally on a discarded 10th prompt
- **WHEN** nine decided prompts have settled with the last applying `high`, and the 10th prompt's result is discarded
- **THEN** the status line reads `Jev · standard · 10 prompts · 0 workers · 0 fallbacks`, and when the 11th prompt is answered without `effort` it reads `Jev · standard · high`

#### Scenario: Effort off never shows the tally
- **WHEN** `effort` is off and the operator sends ten prompts
- **THEN** the status line reads `Jev · standard` throughout
