## MODIFIED Requirements

### Requirement: Config is validated as a whole
Reading `config.json` SHALL return either a valid config or the full list of problems, each with the field path (dot and index notation, `""` for the whole file) and what was expected. An invalid result MUST carry no config values, so a caller cannot act on part of a malformed file. A read MUST collect every problem, not only the first. Problem messages MUST NOT include the value found, so a secret in the file never reaches a message.

#### Scenario: Valid full example
- **WHEN** `config.json` holds the full example from `docs/configuration.md`
- **THEN** the read is valid and returns those values

#### Scenario: Several problems reported together
- **WHEN** `config.json` has `classifier.timeoutMs` set to `100` and `crew.slots[0].name` set to `"Reviewer"`
- **THEN** the read is invalid with two problems, at `classifier.timeoutMs` and `crew.slots[0].name`

#### Scenario: Invalid result has no values
- **WHEN** `config.json` has a valid `tiers.basic` and an invalid `classifier.timeoutMs`
- **THEN** the read is invalid and returns problems only, no `tiers.basic`

#### Scenario: Bad JSON
- **WHEN** `config.json` is not valid JSON
- **THEN** the read is invalid with one problem at path `""`

#### Scenario: Section of the wrong type
- **WHEN** `classifier` is `"x"` in one read and `null` in another
- **THEN** each read is invalid with a problem at `classifier`

#### Scenario: Top level is not an object
- **WHEN** `config.json` holds a JSON array
- **THEN** the read is invalid with one problem at path `""`

#### Scenario: Value is not echoed
- **WHEN** `classifier.apiKeyEnv` holds `"sk-test-0123456789abcdef"`
- **THEN** the problem at `classifier.apiKeyEnv` does not contain that string

#### Scenario: Unreadable file
- **WHEN** `config.json` exists but cannot be read
- **THEN** the read is invalid with one problem at path `""` naming the error code, and nothing is thrown

### Requirement: Tier and slot field rules
Each of `tiers.basic`, `tiers.broad`, `tiers.deep` and `tiers.frontier` SHALL be optional and, when set, MUST be an exact `provider/id` of at most 128 characters with no whitespace. For one minor release, `tiers.fast`, `tiers.balanced` and `tiers.expert` SHALL be accepted, under the same rule, as deprecated aliases of `tiers.basic`, `tiers.broad` and `tiers.frontier`. A valid read that used an alias SHALL return the value under the new key, together with one deprecation notice per alias naming the new key; the `/jev` status SHALL show it. When an alias and its new key are both present, the read MUST be invalid, with a problem at the alias. `frontier` joins the reserved slot names in `docs/configuration.md`. A slot named `frontier` already in `config.json` (valid before this rename) MUST still be accepted on read and routed, with a deprecation notice asking to rename it; the slot writer MUST refuse a new slot named `frontier`, and MUST refuse any write that keeps an existing `frontier` slot, with a problem at that slot's `name` asking to rename it (see `slot-commands` for what the commands do meanwhile). `crew.slots` MUST have at most 8 entries; each needs a unique `name` matching `^[a-z][a-z0-9-]{0,23}$` that is not a reserved word from `docs/configuration.md`, a `model` as an exact `provider/id`, and a `when` of 1–500 characters after trimming. A slot without `when` MUST be invalid; there is no default `when`.

#### Scenario: Tier without provider rejected
- **WHEN** `tiers.basic` is `"claude-haiku-5-5"`
- **THEN** the read is invalid with a problem at `tiers.basic`

#### Scenario: Unknown tier rejected
- **WHEN** `tiers` has a key `ultra`
- **THEN** the read is invalid with a problem at `tiers.ultra`

#### Scenario: Model too long
- **WHEN** `tiers.deep` is a `provider/id` of 129 characters
- **THEN** the read is invalid with a problem at `tiers.deep`

#### Scenario: Deprecated tier key accepted
- **WHEN** `tiers.fast` is `"fixture/fixture-basic"` and `tiers.basic` is absent
- **THEN** the read is valid, returns `tiers.basic` `fixture/fixture-basic` and no `tiers.fast`, and carries a deprecation notice naming `tiers.basic`

#### Scenario: Every deprecated tier key
- **WHEN** `tiers` holds `fast`, `balanced`, `deep` and `expert`
- **THEN** the read is valid, returns `basic`, `broad`, `deep` and `frontier`, and carries three deprecation notices

#### Scenario: Alias and new key both present
- **WHEN** `tiers` holds both `expert` and `frontier`
- **THEN** the read is invalid with a problem at `tiers.expert`, and no config value is returned

#### Scenario: Existing frontier slot still read
- **WHEN** `crew.slots` holds a valid slot named `frontier`
- **THEN** the read is valid, the slot is returned and offered as `slot::frontier`, and a deprecation notice asks to rename it

#### Scenario: New frontier slot refused
- **WHEN** the slot writer is given a slot named `frontier`
- **THEN** it returns a problem at that slot's `name` and the file is unchanged

#### Scenario: Invalid alias value
- **WHEN** `tiers.balanced` is `"claude-sonnet"`
- **THEN** the read is invalid with a problem at `tiers.balanced`

#### Scenario: Slot when bounds
- **WHEN** a slot's `when` is only spaces in one read and 501 characters in another
- **THEN** each read is invalid with a problem at that slot's `when`

#### Scenario: Too many slots
- **WHEN** `crew.slots` has 9 valid entries
- **THEN** the read is invalid with a problem at `crew.slots`

#### Scenario: Reserved slot name
- **WHEN** a slot is named `review`
- **THEN** the read is invalid with a problem at that slot's `name`

#### Scenario: Duplicate slot name
- **WHEN** two slots are both named `reviewer`
- **THEN** the read is invalid with a problem at the second slot's `name`

#### Scenario: Slot without model
- **WHEN** a slot has a `name` but no `model`
- **THEN** the read is invalid with a problem at that slot's `model`

#### Scenario: Slot without when
- **WHEN** a slot has a `name` and a `model` but no `when`
- **THEN** the read is invalid with a problem at that slot's `when`

#### Scenario: Slot writer refuses a slot without when
- **WHEN** the slot writer is given a slot with no `when`
- **THEN** it returns a problem at that slot's `when` and the file is unchanged

### Requirement: Invalid config is never written
No store operation SHALL write `config.json` while its current content is invalid, and no store operation other than the slot writer and the legacy tier migration MUST write it at all.

#### Scenario: Read leaves the file untouched
- **WHEN** an invalid `config.json` is read
- **THEN** its bytes and modification time are unchanged

#### Scenario: Slot writer refuses an invalid file
- **WHEN** the slot writer runs while `config.json` is invalid
- **THEN** it returns the file's problems and the file is unchanged

#### Scenario: Migration refuses an invalid file
- **WHEN** `config.json` holds `tiers.fast` and an invalid `classifier.timeoutMs`, and the migration runs
- **THEN** the file is unchanged


## ADDED Requirements

### Requirement: Legacy tier migration
At every main `session_start`, before the status line is drawn, the package SHALL rewrite a valid `config.json` holding a legacy tier key atomically, with each alias renamed to its new key in place and every other key, value, order and the file mode kept. It SHALL rewrite a valid `state.json` holding `switches.expert` through the state store. A slot named `frontier` MUST NOT be renamed.

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
The migration MUST NOT run in a child session, MUST make no network call, and MUST NOT write a file that needs no change or is invalid. A write failure MUST be swallowed; the session starts, the aliases keep working on read, and the next main `session_start` tries again. After a config rewrite the package SHALL show one info notification naming the renamed keys and the path, when a UI is present.

#### Scenario: Nothing to migrate
- **WHEN** `config.json` uses only the new tier names and `state.json` has no `switches.expert`, and a main session starts
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
