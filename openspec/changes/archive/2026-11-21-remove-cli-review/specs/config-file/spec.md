## MODIFIED Requirements

### Requirement: Invalid config is never written
No store operation SHALL write `config.json` while its current content is invalid, and no store operation other than the slot writer, the legacy tier migration and the retired CLI review migration MUST write it at all.

#### Scenario: Read leaves the file untouched
- **WHEN** an invalid `config.json` is read
- **THEN** its bytes and modification time are unchanged

#### Scenario: Slot writer refuses an invalid file
- **WHEN** the slot writer runs while `config.json` is invalid
- **THEN** it returns the file's problems and the file is unchanged

#### Scenario: Migration refuses an invalid file
- **WHEN** `config.json` holds `tiers.fast` and an invalid `classifier.timeoutMs` in one case, and `review` and an invalid `classifier.timeoutMs` in another, and the migration runs
- **THEN** the file is unchanged in both cases

### Requirement: Slot writer replaces only crew.slots
<!-- Intentional change: "New crew key goes last" uses `skills` instead of the retired `review` section, and "Retired review section not written back" is added. -->
The slot writer SHALL validate the new slot list against the rules for `crew.slots` and, if valid, replace only `crew.slots` in the current config and write the file atomically. Every other key and value MUST be kept, in its original order, except the retired `review` section, which MUST NOT be written back. An absent `crew` MUST be added as the last top-level key. An empty list MUST remove `crew.slots`, and `crew` once it is empty. A missing `config.json` MUST be created holding only the slots.

#### Scenario: Other keys kept
- **WHEN** the slot writer adds a slot to the full example config
- **THEN** a new read returns the same values for every key other than `crew.slots`, in the same key order, and the new slot list

#### Scenario: Invalid new slot refused
- **WHEN** the slot writer is given a slot named `all`
- **THEN** it returns a problem at that slot's `name` and the file is unchanged

#### Scenario: New crew key goes last
- **WHEN** `config.json` holds `classifier` and `skills` and no `crew`, and the slot writer is given one valid slot
- **THEN** the written top-level keys are `classifier`, `skills`, `crew` in that order

#### Scenario: Retired review section not written back
- **WHEN** `config.json` holds `classifier`, `review` and `skills`, and the slot writer is given one valid slot
- **THEN** the written top-level keys are `classifier`, `skills`, `crew` in that order

#### Scenario: Last slot removed
- **WHEN** the slot writer is given an empty list and `crew` holds only `slots`
- **THEN** the written config has no `crew` key

#### Scenario: Created from nothing
- **WHEN** there is no `config.json` and the slot writer is given one valid slot
- **THEN** `config.json` is created with mode `0600`, holding only `crew.slots` with that slot

### Requirement: Legacy tier migration
<!-- Intentional change: the same rewrite also removes the retired `review` key; scenarios unchanged. -->
At every main `session_start`, before the status line is drawn, the package SHALL rewrite a valid `config.json` holding a legacy tier key atomically, with each alias renamed to its new key in place and every other key, value, order and the file mode kept, except a retired `review` key, which is removed in the same write (see "Retired CLI review migration"). It SHALL rewrite a valid `state.json` holding `switches.expert` through the state store. A slot named `frontier` MUST NOT be renamed.

#### Scenario: Config migrated at start
- **WHEN** `config.json` holds `classifier`, then `tiers` `{"fast":"a/x","deep":"a/y","expert":"a/z"}`, and a main session starts
- **THEN** `config.json` holds `classifier`, then `tiers` `{"basic":"a/x","deep":"a/y","frontier":"a/z"}`, its mode is unchanged, and one notification names `tiers.fast → tiers.basic` and `tiers.expert → tiers.frontier`

#### Scenario: State migrated at start
- **WHEN** `state.json` holds `{"version":1,"switches":{"expert":false,"skills":false}}` and a main session starts
- **THEN** `state.json` holds `switches` `{"skills":false,"frontier":false}` and no `expert`

#### Scenario: Legacy frontier slot kept
- **WHEN** `config.json` holds `tiers.fast` and a slot named `frontier`, and a main session starts
- **THEN** `tiers.fast` becomes `tiers.basic`, the `frontier` slot is unchanged, and its rename notice remains

### Requirement: Legacy tier migration safety
<!-- Intentional change: the rules cover the retired CLI review removal; "Nothing to migrate" also requires no retired CLI review key. -->
The migration, including the retired CLI review removal, MUST NOT run in a child session, MUST make no network call, and MUST NOT write a file that needs no change or is invalid. A write failure MUST be swallowed; the session starts, the aliases keep working on read, and the next main `session_start` tries again. After a config rewrite the package SHALL show one info notification naming the renamed and removed keys and the path, when a UI is present.

#### Scenario: Nothing to migrate
- **WHEN** `config.json` uses only the new tier names and has no `review` key, `state.json` has no `switches.expert`, `cliReview` or `cliReviewEnabled`, and a main session starts
- **THEN** neither file's bytes nor modification time change, and no notification is shown

#### Scenario: Conflicting keys left alone
- **WHEN** `config.json` holds both `tiers.expert` and `tiers.frontier`, and a main session starts
- **THEN** `config.json` is unchanged and `/jev` reports the problem at `tiers.expert`

#### Scenario: Write failure
- **WHEN** `config.json` holds `tiers.fast`, the jev directory is read-only, and a main session starts
- **THEN** the session starts, routing uses the `tiers.fast` model as `basic`, and no error reaches Pi

#### Scenario: Child session
- **WHEN** a worker's child session starts while `config.json` holds `tiers.fast`
- **THEN** `config.json` is unchanged by that session

## ADDED Requirements

### Requirement: Optional section rules
These fields SHALL be optional and MUST follow these rules:
- `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`;
- `skills.inject` is `content` or `suggest`;
- `state.parentRequest` is a boolean;
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
- **WHEN** `skills.inject` is `"full"` and `subagents.forkLaunch` is `"skip"`
- **THEN** the read is invalid with problems at `skills.inject` and `subagents.forkLaunch`

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

### Requirement: Retired CLI review section
For one minor release, a top-level `review` key, left from the removed CLI review, SHALL be accepted with any value. It MUST NOT make the read invalid and MUST NOT contribute any setting.

#### Scenario: Old review section accepted and ignored
- **WHEN** `config.json` holds `{"review":{"cli":"opencode","enabled":true},"skills":{"inject":"suggest"}}`
- **THEN** the read is valid, returns `skills.inject` `suggest`, and returns no `review` setting

#### Scenario: Review section of any shape
- **WHEN** `review.cli` is `"claude"` in one read, `review.enabled` is `"on"` in another, and `review` is `true` in a third
- **THEN** all three reads are valid and return no `review` setting

### Requirement: Retired CLI review migration
At every main `session_start`, before the status line is drawn and in the same step as the legacy tier migration, the package SHALL rewrite a valid `config.json` holding a top-level `review` key atomically without that key, keeping every other key, value, order and the file mode, except legacy tier aliases, which are renamed in place in the same write (see "Legacy tier migration"). It SHALL rewrite a valid `state.json` holding `cliReview` or `cliReviewEnabled` through the state store, which drops both. A config needing both a tier rename and the removal MUST be rewritten once.

#### Scenario: Config review removed at start
- **WHEN** `config.json` holds `classifier`, then `review` `{"cli":"codex","enabled":true}`, then `skills`, and a main session starts
- **THEN** `config.json` holds `classifier`, then `skills`, and no `review`, its mode is unchanged, and one notification names `review` and the path of `config.json`

#### Scenario: Rename and removal in one rewrite
- **WHEN** `config.json` holds `tiers` `{"fast":"a/x"}` and `review` `{"enabled":false}`, and a main session starts
- **THEN** `config.json` holds `tiers` `{"basic":"a/x"}` and no `review`, and exactly one notification names `tiers.fast → tiers.basic` and `review`

#### Scenario: State CLI review fields removed at start
- **WHEN** `state.json` holds `{"version":1,"mode":"budget","cliReview":{"cli":"codex"},"cliReviewEnabled":true}` and a main session starts
- **THEN** `state.json` holds `version` and `mode` `budget`, and no `cliReview` or `cliReviewEnabled`

### Requirement: Retired CLI review migration safety
The retired CLI review migration MUST follow every rule of "Legacy tier migration safety": main session only, no network call, no write to a file that needs no change or is invalid, and a swallowed write failure retried at the next main `session_start`. After a config rewrite that removed `review`, the package SHALL show one info notification naming `review` and the path, when a UI is present; one rewrite MUST NOT show more than one notification.

#### Scenario: Nothing retired to remove
- **WHEN** `config.json` has no `review` key, `state.json` has neither `cliReview` nor `cliReviewEnabled`, no legacy tier key or `switches.expert` is present, and a main session starts
- **THEN** neither file's bytes nor modification time change, and no notification is shown

#### Scenario: Invalid config keeps its review section
- **WHEN** `config.json` holds `review` and an invalid `classifier.timeoutMs`, and a main session starts
- **THEN** `config.json` is unchanged and `/jev` reports the problem at `classifier.timeoutMs`

#### Scenario: Removal write failure
- **WHEN** `config.json` holds `review`, the jev directory is read-only, and a main session starts
- **THEN** the session starts, no error reaches Pi, and `config.json` still holds `review`

#### Scenario: Child session leaves the review section
- **WHEN** a worker's child session starts while `config.json` holds `review`
- **THEN** `config.json` is unchanged by that session

## REMOVED Requirements

### Requirement: Optional field rules

**Reason**: Restated as "Optional section rules" because the review.cli and review.enabled rules and their scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "Optional section rules" in this capability.
