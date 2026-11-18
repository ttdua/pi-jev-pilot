## ADDED Requirements

### Requirement: Optional field rules
These fields SHALL be optional and MUST follow these rules: `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`; `skills.inject` is `content` or `suggest`; `state.parentRequest` is a boolean; `review.cli` is `codex` or `opencode`; `review.enabled` is a boolean; `subagents.forkedLaunch` is `untouched` or `thinking`.

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
- **WHEN** `skills.inject` is `"full"` and `review.cli` is `"claude"`
- **THEN** the read is invalid with problems at `skills.inject` and `review.cli`

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

### Requirement: Deprecated tools section
A top-level `tools` key, left from the removed tool assessment, SHALL be accepted with any value. It MUST NOT make the read invalid and MUST NOT contribute any setting. The read SHALL report `tools` as deprecated so `/jev` can name it.

#### Scenario: Deprecated tools section ignored
- **WHEN** `config.json` holds `{"tools":{"mode":"enforce","grantAt":0.9}}`
- **THEN** the read is valid, returns no `tools` setting and reports `tools` as deprecated

#### Scenario: Deprecated tools section of any shape
- **WHEN** `tools.grantAt` is `0.3` in one read, `"high"` in another, and `tools` is `true` in a third
- **THEN** all three reads are valid and report `tools` as deprecated

#### Scenario: No tools section, nothing deprecated
- **WHEN** `config.json` has no `tools` key
- **THEN** the read reports nothing deprecated

## REMOVED Requirements

### Requirement: Other field rules

**Reason**: Restated under a new name because the `tools.mode` and `tools.grantAt` rules are removed and their scenarios no longer apply; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Optional field rules" in this capability.
