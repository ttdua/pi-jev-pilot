# slot-commands Specification

## Purpose
The three `/jev` slot forms that add, replace, show and remove a custom model slot in `config.json`: their parsing, the check order, the model check against Pi's registry with nearest-name hints, and what each form reports.

## Requirements

### Requirement: Slot command forms
`/jev` SHALL accept three slot forms: `/jev <slot> <provider/model> [when <text>]` adds or replaces a slot, `/jev <slot>` shows it, and `/jev remove <slot>` deletes it. `<slot>` MUST be a valid, non-reserved slot name (`^[a-z][a-z0-9-]{0,23}$`, not in the reserved list of `docs/configuration.md`). Any other shape MUST produce usage text and change nothing. No slot form SHALL call Jev or any network service.

#### Scenario: Reserved name
- **WHEN** the operator runs `/jev review fixture/fixture-review when Choose for reviews.`
- **THEN** usage text is reported and `config.json` is unchanged

#### Scenario: Remove with extra words
- **WHEN** the operator runs `/jev remove reviewer now`
- **THEN** usage text is reported and `config.json` is unchanged

#### Scenario: Name-shaped typo of a feature
- **WHEN** the operator runs `/jev colors off`
- **THEN** an error says `off` is not a `provider/model`, the usage text is included, and `config.json` is unchanged

### Requirement: When text parsing
In the add form, the third word, when present, MUST be exactly `when`, followed by at least one non-space character. Everything after `when` SHALL be the `when` text, trimmed at both ends and kept verbatim inside. Any other third word, or `when` with nothing after it, MUST produce usage text and change nothing.

#### Scenario: Add with when
- **WHEN** the operator runs `/jev reviewer fixture/fixture-review when Choose for reviews.  Not for fixing.`
- **THEN** the slot `reviewer` is stored with model `fixture/fixture-review` and `when` `Choose for reviews.  Not for fixing.`

#### Scenario: Third word not when
- **WHEN** the operator runs `/jev reviewer fixture/fixture-review for reviews`
- **THEN** usage text is reported and `config.json` is unchanged

#### Scenario: Empty when
- **WHEN** the operator runs `/jev reviewer fixture/fixture-review when   `
- **THEN** usage text is reported and `config.json` is unchanged

### Requirement: Adding a slot
Adding a slot that does not exist SHALL require `when`; without it, the command MUST be refused with an error that says a new slot needs `when` and how to write one (what to choose the slot for, and what not). The model MUST be an exact `provider/id` that names a model in Pi's model registry with configured credentials. A new slot SHALL be appended after the existing slots. The command MUST write through the slot writer, then report the slot.

#### Scenario: New slot without when
- **WHEN** no slot `reviewer` exists and the operator runs `/jev reviewer fixture/fixture-review`
- **THEN** an error says a new slot needs `when`, and `config.json` is unchanged

#### Scenario: Write error
- **WHEN** the jev directory is read-only and the operator adds a valid slot
- **THEN** an error naming the error code is reported, and `config.json` is unchanged (skipped when the test runs as root)

#### Scenario: New slot appended
- **WHEN** slot `bulk` exists and the operator adds `reviewer` with a usable model and a `when`
- **THEN** `crew.slots` holds `bulk` then `reviewer`, every other key of `config.json` is unchanged, and the report shows slot `reviewer` with its model and `when`

#### Scenario: Ninth slot
- **WHEN** eight slots exist and the operator adds a ninth
- **THEN** an error names `crew.slots`, and `config.json` is unchanged

#### Scenario: Created from nothing
- **WHEN** there is no `config.json` and the operator adds `reviewer` with a usable model and a `when`
- **THEN** `config.json` is created holding only `crew.slots` with that slot

### Requirement: Order of slot checks
An add or replace SHALL run its checks in this order, after the invalid-config refusal: parsing, then the model's `provider/id` shape, then the `when` requirement, then the registry and credentials check, then the slot writer's rules. The first failure MUST be the only error reported.

#### Scenario: Missing when reported before an unknown model
- **WHEN** no slot `reviewer` exists and the operator runs `/jev reviewer fixture/unknown`
- **THEN** the only error says a new slot needs `when`

#### Scenario: Bad model shape reported before missing when
- **WHEN** no slot `colors` exists and the operator runs `/jev colors off`
- **THEN** the only error says `off` is not a `provider/model`

### Requirement: Replacing a slot
Running the add form for a slot that exists SHALL replace its model, and its `when` when one is given. When `when` is omitted, the existing `when` MUST be kept. The slot MUST keep its position in `crew.slots`.

#### Scenario: Replace the model, keep when
- **WHEN** slot `reviewer` has `when` `Choose for reviews.` and the operator runs `/jev reviewer fixture/fixture-other`
- **THEN** the slot has model `fixture/fixture-other` and `when` `Choose for reviews.`

#### Scenario: Replace when
- **WHEN** slot `reviewer` exists and the operator runs `/jev reviewer fixture/fixture-review when Choose for audits.`
- **THEN** the slot has `when` `Choose for audits.`

#### Scenario: Position kept
- **WHEN** slots are `reviewer` then `bulk` and the operator replaces `reviewer`'s model
- **THEN** `crew.slots` is still `reviewer` then `bulk`

### Requirement: Model check
A slot model that is not a `provider/id`, is not in Pi's model registry, or has no configured credentials SHALL be refused with an error naming the reason: `not a provider/model`, `not in the model registry` or `no credentials`. Nothing MUST be written.

#### Scenario: Keyless model refused
- **WHEN** `fixture2/fixture-deep` is in the registry without credentials and the operator adds a slot with it
- **THEN** an error says `no credentials`, and `config.json` is unchanged

### Requirement: Nearest names
A slot model refused as `not in the model registry` or `no credentials` SHALL be followed by up to three closest model ids; a model refused as `not a provider/model` gets no suggestions. The suggestions are chosen only among registry models with configured credentials. They MUST be ordered by edit distance to the typed id, ignoring case, with ties broken alphabetically. They MUST come from the local registry, with no network call.

#### Scenario: Typo suggests the right model
- **WHEN** the registry has usable models `fixture/fixture-review`, `fixture/fixture-fast`, `fixture/fixture-main` and `fixture/fixture-balanced`, and the operator runs `/jev reviewer fixture/fixture-reviw when Choose for reviews.`
- **THEN** an error says `not in the model registry` and its suggestions start with `fixture/fixture-review` and hold at most three ids

#### Scenario: Keyless model not suggested
- **WHEN** `fixture2/fixture-deep` is in the registry without credentials and the operator adds a slot with it
- **THEN** the suggestions do not include `fixture2/fixture-deep`

#### Scenario: No usable model at all
- **WHEN** no registry model has credentials and the operator adds a slot with an unknown model
- **THEN** an error says `not in the model registry` with no suggestions

### Requirement: Showing and removing a slot
`/jev <slot>` SHALL report the slot's name, model and `when` without writing anything. `/jev remove <slot>` SHALL remove the slot through the slot writer and report that it was removed. For a slot that does not exist, both forms MUST report an error naming the slot, followed by the usage text, and change nothing.

#### Scenario: Show
- **WHEN** slot `reviewer` exists and the operator runs `/jev reviewer`
- **THEN** the report shows `reviewer`, its model and its `when`, and `config.json` is unchanged

#### Scenario: Show unknown
- **WHEN** no slot `reviewer` exists and the operator runs `/jev reviewer`
- **THEN** an error names `reviewer` and includes the usage text, and `config.json` is unchanged

#### Scenario: Remove the last slot
- **WHEN** `crew` holds only slot `reviewer` and the operator runs `/jev remove reviewer`
- **THEN** `config.json` has no `crew` key and the report says `reviewer` was removed

#### Scenario: Remove unknown
- **WHEN** no slot `bulk` exists and the operator runs `/jev remove bulk`
- **THEN** an error names `bulk`, and `config.json` is unchanged

### Requirement: Slot commands and an invalid config
While `config.json` is invalid, every slot form SHALL be refused with the file's problems, by field path, as an error, and MUST NOT write the file.

#### Scenario: Add refused on an invalid file
- **WHEN** `config.json` has an invalid `classifier.timeoutMs` and the operator adds a slot
- **THEN** an error names `classifier.timeoutMs`, and the file's bytes are unchanged

#### Scenario: Show refused on an invalid file
- **WHEN** `config.json` is not valid JSON and the operator runs `/jev reviewer`
- **THEN** an error reports the problem at the whole file, and the file's bytes are unchanged

### Requirement: Slot command output and failures
Slot command output SHALL follow the `/jev` output channel: `ctx.ui.notify` only when `ctx.hasUI`, nothing in print or JSON mode, and nothing in a child session. A change made in print mode MUST still be written. An unexpected error MUST be caught inside the package. After a slot change, the next worker launch MUST read the new slot list.

#### Scenario: Print mode
- **WHEN** Pi runs `/jev reviewer fixture/fixture-review when Choose for reviews.` with `-p`
- **THEN** stdout holds nothing from the package and `config.json` holds the slot

#### Scenario: Child session
- **WHEN** a slot form runs with a session id that the child registry holds
- **THEN** it returns without notifying or writing `config.json`

#### Scenario: Next launch sees the slot
- **WHEN** the operator adds slot `reviewer` and the main model then launches a worker
- **THEN** that worker request offers `slot::reviewer`
