## MODIFIED Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state and an optional tuning layer. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields and there is no tuning layer
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `state.parentRequest` `false`, `review.cli` `codex`, `subagents.forkedLaunch` `untouched`, mode `standard`, and every feature on except `verbose`

#### Scenario: Config over default
- **WHEN** the config sets `classifier.timeoutMs` to `2000`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuning over config
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `2200` with base `2000`
- **THEN** the result's `classifier.timeoutMs` is `2200`

#### Scenario: Forked launch from config
- **WHEN** the config sets `subagents.forkedLaunch` to `thinking`
- **THEN** the result's `subagents.forkedLaunch` is `thinking`

### Requirement: Tuning is limited to tunable values
The tuning layer SHALL accept only `timeoutMs` in this phase, as a `value` and the `base` it was tuned from, each an integer from 300 to 5000. The tuned value MUST apply only when `base` equals the untuned value (the config's `classifier.timeoutMs`, or the default). Otherwise the untuned value applies. Any other value in the tuning layer MUST be ignored by the resolver.

#### Scenario: Non-integer tuning ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `1800.5` with base `1500`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default

#### Scenario: Out-of-range tuning ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `9000` with base `1500`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default

#### Scenario: Config edited after tuning
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `1700` with base `1500`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuned from the default
- **WHEN** the config does not set `classifier.timeoutMs` and the tuning layer sets `timeoutMs` to value `1700` with base `1500`
- **THEN** the result's `classifier.timeoutMs` is `1700`

#### Scenario: Invalid base ignored
- **WHEN** the config does not set `classifier.timeoutMs` and the tuning layer sets `timeoutMs` to value `1700` with base `1500.5`
- **THEN** the result's `classifier.timeoutMs` is `1500`

#### Scenario: Missing base ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `1700` with no base
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default
