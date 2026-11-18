## ADDED Requirements

### Requirement: Effective settings resolver
Effective settings SHALL come from one pure function of a valid config, the state, an optional tuning layer and an optional directory mode. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. For the mode, the directory mode wins over the state (see State overrides). The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields, and there is no tuning layer and no directory mode
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `state.parentRequest` `false`, `review.cli` `codex`, `review.enabled` `false`, `subagents.forkedLaunch` `untouched`, mode `standard` with source `global` and global mode `standard`, and every feature on except `verbose`

#### Scenario: Config over default
- **WHEN** the config sets `classifier.timeoutMs` to `2000`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuning over config
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `2200` with base `2000`
- **THEN** the result's `classifier.timeoutMs` is `2200`

#### Scenario: Forked launch from config
- **WHEN** the config sets `subagents.forkedLaunch` to `thinking`
- **THEN** the result's `subagents.forkedLaunch` is `thinking`

#### Scenario: Ignored tools section
- **WHEN** the config holds `{"tools":{"mode":"enforce","grantAt":0.9}}`
- **THEN** the result has no `tools` setting and equals the result for an empty config

## REMOVED Requirements

### Requirement: One resolver for effective settings

**Reason**: Restated under a new name because resolved settings no longer hold `tools` and the grant-cut scenario no longer applies; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Effective settings resolver" in this capability.
