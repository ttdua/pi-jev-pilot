## MODIFIED Requirements

### Requirement: Other field rules
These fields SHALL be optional and MUST follow these rules: `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`; `skills.inject` is `content` or `suggest`; `tools.mode` is `observe` or `enforce`; `state.parentRequest` is a boolean; `review.cli` is `codex` or `opencode`; `review.enabled` is a boolean; `subagents.forkedLaunch` is `untouched` or `thinking`.

#### Scenario: Duplicate hold provider
- **WHEN** `effort.holdProviders` is `["9router", "9router"]`
- **THEN** the read is invalid with a problem at `effort.holdProviders[1]`

#### Scenario: Hold provider bounds
- **WHEN** `effort.holdProviders` has 33 unique names in one read, and holds `"bad name"` in another
- **THEN** the first read is invalid at `effort.holdProviders` and the second at `effort.holdProviders[0]`

#### Scenario: Non-boolean parentRequest
- **WHEN** `state.parentRequest` is `"yes"`
- **THEN** the read is invalid with a problem at `state.parentRequest`

#### Scenario: Enum values
- **WHEN** `skills.inject` is `"full"`, `tools.mode` is `"remove"` and `review.cli` is `"claude"`
- **THEN** the read is invalid with problems at `skills.inject`, `tools.mode` and `review.cli`

#### Scenario: CLI review enabled accepted
- **WHEN** `review` is `{"cli":"opencode","enabled":true}`
- **THEN** the read is valid and returns those values

#### Scenario: Non-boolean review.enabled
- **WHEN** `review.enabled` is `"on"`
- **THEN** the read is invalid with a problem at `review.enabled`

#### Scenario: Forked launch setting accepted
- **WHEN** `subagents.forkedLaunch` is `"thinking"`
- **THEN** the read is valid and returns that value

#### Scenario: Forked launch setting rejected
- **WHEN** `subagents.forkedLaunch` is `"skip"` in one read, and `subagents` holds an unknown key `inheritContext` in another
- **THEN** the first read is invalid at `subagents.forkedLaunch` and the second at `subagents.inheritContext`

