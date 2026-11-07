## MODIFIED Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state and an optional tuning layer. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields and there is no tuning layer
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `state.parentRequest` `false`, `review.cli` `codex`, `review.enabled` `false`, `subagents.forkedLaunch` `untouched`, mode `standard`, and every feature on except `verbose`

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
The state SHALL override the switches and mode defaults. Its CLI review default SHALL replace the config's `review.cli` together with any model and effort, and its `cliReviewEnabled` SHALL override the config's `review.enabled`. Each of the two MUST resolve independently of the other.

#### Scenario: Switch off
- **WHEN** the state turns `skills` off
- **THEN** the result has `skills` off and every other feature at its default

#### Scenario: Mode from state
- **WHEN** the state sets the mode to `premium`
- **THEN** the result's mode is `premium`

#### Scenario: CLI review default from state
- **WHEN** the config sets `review.cli` to `codex` and the state sets the CLI review default to `opencode` with no model
- **THEN** the result's `review.cli` is `opencode`, with no model and no effort

#### Scenario: CLI review on from the config
- **WHEN** the config sets `review.enabled` to `true` and the state has no `cliReviewEnabled`
- **THEN** the result's `review.enabled` is `true`

#### Scenario: CLI review off from the state
- **WHEN** the config sets `review.enabled` to `true` and the state sets `cliReviewEnabled` to `false`
- **THEN** the result's `review.enabled` is `false`

#### Scenario: Reviewer from state keeps the config's enabled
- **WHEN** the config sets `review` to `{"cli":"codex","enabled":true}` and the state sets the CLI review default to `opencode` with no `cliReviewEnabled`
- **THEN** the result's `review` is `opencode` with `enabled` `true`

#### Scenario: Config review without state
- **WHEN** the config sets `review.cli` to `opencode` and the state has no CLI review default
- **THEN** the result's `review.cli` is `opencode`

