## MODIFIED Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state, an optional tuning layer and an optional directory mode. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. For the mode, the directory mode wins over the state (see State overrides). The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields, and there is no tuning layer and no directory mode
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `tools.grantAt` `0.8`, `state.parentRequest` `false`, `review.cli` `codex`, `review.enabled` `false`, `subagents.forkedLaunch` `untouched`, mode `standard` with source `global` and global mode `standard`, and every feature on except `verbose`

#### Scenario: Config over default
- **WHEN** the config sets `classifier.timeoutMs` to `2000`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuning over config
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `2200` with base `2000`
- **THEN** the result's `classifier.timeoutMs` is `2200`

#### Scenario: Forked launch from config
- **WHEN** the config sets `subagents.forkedLaunch` to `thinking`
- **THEN** the result's `subagents.forkedLaunch` is `thinking`


#### Scenario: Grant cut from config
- **WHEN** the config sets `tools.grantAt` to `0.9`
- **THEN** the result's `tools.grantAt` is `0.9`
