## MODIFIED Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state, an optional tuning layer and an optional session mode. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. For the mode, the session mode wins over the state (see State overrides). The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields, and there is no tuning layer and no session mode
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `state.parentRequest` `false`, `review.cli` `codex`, `subagents.forkedLaunch` `untouched`, mode `standard` with source `saved` and saved mode `standard`, and every feature on except `verbose`

#### Scenario: Config over default
- **WHEN** the config sets `classifier.timeoutMs` to `2000`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuning over config
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `2200` with base `2000`
- **THEN** the result's `classifier.timeoutMs` is `2200`

#### Scenario: Forked launch from config
- **WHEN** the config sets `subagents.forkedLaunch` to `thinking`
- **THEN** the result's `subagents.forkedLaunch` is `thinking`

### Requirement: State overrides
The state SHALL override the switches and mode defaults, and its CLI review default SHALL replace the config's `review` setting as a whole. A session mode, when given, SHALL override the state's mode and the default for the mode only. The result MUST carry the saved mode (the state's mode, else the default) and the mode's source: `session` when the session mode was given, otherwise `saved`. A session mode MUST NOT change any other setting.

#### Scenario: Switch off
- **WHEN** the state turns `skills` off
- **THEN** the result has `skills` off and every other feature at its default

#### Scenario: Mode from state
- **WHEN** the state sets the mode to `premium`
- **THEN** the result's mode is `premium`, with source `saved`

#### Scenario: Session mode over state
- **WHEN** the state sets the mode to `premium` and the session mode is `budget`
- **THEN** the result's mode is `budget`, with source `session` and saved mode `premium`

#### Scenario: Session mode over the default
- **WHEN** the state has no mode and the session mode is `premium`
- **THEN** the result's mode is `premium`, with source `session` and saved mode `standard`

#### Scenario: Session mode changes only the mode
- **WHEN** the state turns `skills` off and the session mode is `premium`
- **THEN** the result equals the result without a session mode, except mode `premium` and source `session`

#### Scenario: CLI review default from state
- **WHEN** the config sets `review.cli` to `codex` and the state sets the CLI review default to `opencode` with no model
- **THEN** the result's `review.cli` is `opencode`, with no model and no effort

#### Scenario: Config review without state
- **WHEN** the config sets `review.cli` to `opencode` and the state has no CLI review default
- **THEN** the result's `review.cli` is `opencode`

