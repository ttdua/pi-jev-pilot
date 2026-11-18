## MODIFIED Requirements

### Requirement: Optional field rules
These fields SHALL be optional and MUST follow these rules:
- `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`;
- `skills.inject` is `content` or `suggest`;
- `state.parentRequest` is a boolean;
- `review.cli` is `codex` or `opencode`;
- `review.enabled` is a boolean;
- `subagents.forkLaunch` is `untouched` or `thinking`.

For one minor release, `subagents.forkedLaunch` SHALL be accepted, under the same rule, as a deprecated alias of `subagents.forkLaunch`. A valid read that used the alias SHALL return the value as `subagents.forkLaunch`, together with a deprecation notice naming `subagents.forkLaunch`. The `/jev` status SHALL show that notice. When both keys are present, the whole read MUST be invalid, with a problem at `subagents.forkedLaunch`, as for any other invalid config.

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
- **WHEN** `subagents.forkLaunch` is `"thinking"`
- **THEN** the read is valid and returns that value

#### Scenario: Forked launch setting rejected
- **WHEN** `subagents.forkLaunch` is `"skip"` in one read, and `subagents` holds an unknown key `inheritContext` in another
- **THEN** the first read is invalid at `subagents.forkLaunch` and the second at `subagents.inheritContext`

#### Scenario: Deprecated forkedLaunch accepted
- **WHEN** `subagents.forkedLaunch` is `"thinking"` and `subagents.forkLaunch` is absent
- **THEN** the read is valid, returns `forkLaunch` `thinking`, and carries a deprecation notice naming `subagents.forkLaunch`

#### Scenario: Both keys present
- **WHEN** `subagents` holds both `forkLaunch` and `forkedLaunch`
- **THEN** the read is invalid with a problem at `subagents.forkedLaunch`, and no config value is returned
