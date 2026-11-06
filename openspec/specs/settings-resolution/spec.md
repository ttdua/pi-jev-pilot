# settings-resolution Specification

## Purpose
One pure function merges tuning, state, config and code defaults into complete effective settings, in that order of precedence.

## Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state and an optional tuning layer. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default. The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields and there is no tuning layer
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `state.parentRequest` `false`, `review.cli` `codex`, `subagents.forkedLaunch` `untouched`, mode `standard`, and every feature on except `verbose`

#### Scenario: Config over default
- **WHEN** the config sets `classifier.timeoutMs` to `2000`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuning over config
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets it to `1800`
- **THEN** the result's `classifier.timeoutMs` is `1800`

#### Scenario: Forked launch from config
- **WHEN** the config sets `subagents.forkedLaunch` to `thinking`
- **THEN** the result's `subagents.forkedLaunch` is `thinking`

### Requirement: State overrides
The state SHALL override the switches and mode defaults, and its CLI review default SHALL replace the config's `review` setting as a whole.

#### Scenario: Switch off
- **WHEN** the state turns `skills` off
- **THEN** the result has `skills` off and every other feature at its default

#### Scenario: Mode from state
- **WHEN** the state sets the mode to `premium`
- **THEN** the result's mode is `premium`

#### Scenario: CLI review default from state
- **WHEN** the config sets `review.cli` to `codex` and the state sets the CLI review default to `opencode` with no model
- **THEN** the result's `review.cli` is `opencode`, with no model and no effort

#### Scenario: Config review without state
- **WHEN** the config sets `review.cli` to `opencode` and the state has no CLI review default
- **THEN** the result's `review.cli` is `opencode`

### Requirement: Tuning is limited to tunable values
The tuning layer SHALL accept only `classifier.timeoutMs`, an integer from 300 to 5000, in this phase. Any other value in it MUST be ignored by the resolver.

#### Scenario: Non-integer tuning ignored
- **WHEN** the tuning layer sets `classifier.timeoutMs` to `1800.5`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default

#### Scenario: Out-of-range tuning ignored
- **WHEN** the tuning layer sets `classifier.timeoutMs` to `9000`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default
