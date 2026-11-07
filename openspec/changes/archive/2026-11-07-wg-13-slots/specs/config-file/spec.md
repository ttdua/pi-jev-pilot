## MODIFIED Requirements

### Requirement: Tier and slot field rules
Each of `tiers.fast`, `tiers.balanced`, `tiers.deep` and `tiers.expert` SHALL be optional and, when set, MUST be an exact `provider/id` of at most 128 characters with no whitespace. `crew.slots` MUST have at most 8 entries; each needs a unique `name` matching `^[a-z][a-z0-9-]{0,23}$` that is not a reserved word from `docs/configuration.md`, a `model` as an exact `provider/id`, and a `when` of 1–500 characters after trimming. A slot without `when` MUST be invalid; there is no default `when`.

#### Scenario: Tier without provider rejected
- **WHEN** `tiers.fast` is `"claude-haiku-5-5"`
- **THEN** the read is invalid with a problem at `tiers.fast`

#### Scenario: Unknown tier rejected
- **WHEN** `tiers` has a key `ultra`
- **THEN** the read is invalid with a problem at `tiers.ultra`

#### Scenario: Model too long
- **WHEN** `tiers.deep` is a `provider/id` of 129 characters
- **THEN** the read is invalid with a problem at `tiers.deep`

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
