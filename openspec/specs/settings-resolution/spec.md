# settings-resolution Specification

## Purpose
One pure function merges tuning, state, config and code defaults into complete effective settings, in that order of precedence.

## Requirements

### Requirement: One resolver for effective settings
Effective settings SHALL come from one pure function of a valid config, the state, an optional tuning layer and an optional directory mode. For each value, the tuning layer wins over the state, the state over the config, and the config over the code default, subject to the tuning limits below. For the mode, the directory mode wins over the state (see State overrides). The result MUST be complete: every setting has a value. The function MUST do no I/O.

#### Scenario: Everything defaulted
- **WHEN** the config is empty, the state has no fields, and there is no tuning layer and no directory mode
- **THEN** the result has `classifier.url` `https://api.typesafe.ai/v1/systemone`, `classifier.model` `jev-latest`, `classifier.apiKeyEnv` `TYPESAFE_API_KEY`, `classifier.timeoutMs` `1500`, no tiers, no slots, `effort.holdProviders` `["9router"]`, `skills.inject` `content`, `tools.mode` `observe`, `state.parentRequest` `false`, `review.cli` `codex`, `subagents.forkedLaunch` `untouched`, mode `standard` with source `global` and global mode `standard`, and every feature on except `verbose`

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
The state SHALL override the switches and mode defaults, and its CLI review default SHALL replace the config's `review` setting as a whole. A directory mode, when given, SHALL override the state's mode and the default for the mode only. The result MUST carry the global mode (the state's mode, else the default) and the mode's source: `local` when the directory mode was given, otherwise `global`. A directory mode MUST NOT change any other setting.

#### Scenario: Switch off
- **WHEN** the state turns `skills` off
- **THEN** the result has `skills` off and every other feature at its default

#### Scenario: Mode from state
- **WHEN** the state sets the mode to `premium`
- **THEN** the result's mode is `premium`, with source `global`

#### Scenario: Directory mode over state
- **WHEN** the state sets the mode to `premium` and the directory mode is `budget`
- **THEN** the result's mode is `budget`, with source `local` and global mode `premium`

#### Scenario: Directory mode over the default
- **WHEN** the state has no mode and the directory mode is `premium`
- **THEN** the result's mode is `premium`, with source `local` and global mode `standard`

#### Scenario: Directory mode changes only the mode
- **WHEN** the state turns `skills` off and the directory mode is `premium`
- **THEN** the result equals the result without a directory mode, except mode `premium` and source `local`

#### Scenario: CLI review default from state
- **WHEN** the config sets `review.cli` to `codex` and the state sets the CLI review default to `opencode` with no model
- **THEN** the result's `review.cli` is `opencode`, with no model and no effort

#### Scenario: Config review without state
- **WHEN** the config sets `review.cli` to `opencode` and the state has no CLI review default
- **THEN** the result's `review.cli` is `opencode`

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
