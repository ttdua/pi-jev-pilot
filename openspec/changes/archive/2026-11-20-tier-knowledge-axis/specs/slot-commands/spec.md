## MODIFIED Requirements

### Requirement: Slot command forms
`/jev` SHALL accept three slot forms: `/jev <slot> <provider/model> [when <text>]` adds or replaces a slot, `/jev <slot>` shows it, and `/jev remove <slot>` deletes it. `<slot>` MUST be a valid, non-reserved slot name (`^[a-z][a-z0-9-]{0,23}$`, not in the reserved list of `docs/configuration.md`). Any other shape MUST produce usage text and change nothing. No slot form SHALL call Jev or any network service. `frontier` is a feature, so `/jev frontier on|off` is the switch and `/jev frontier` is not a slot form. While `config.json` still holds a legacy slot named `frontier` (see `config-file`), every add, replace or remove form MUST be refused before any write, with an error naming `crew.slots` and asking to rename that slot in `config.json` by hand, and `config.json` MUST stay unchanged; `/jev <slot>` still shows other slots.

#### Scenario: Reserved name
- **WHEN** the operator runs `/jev review fixture/fixture-review when Choose for reviews.`
- **THEN** usage text is reported and `config.json` is unchanged

#### Scenario: Remove with extra words
- **WHEN** the operator runs `/jev remove reviewer now`
- **THEN** usage text is reported and `config.json` is unchanged

#### Scenario: Legacy frontier slot blocks writes
- **WHEN** `config.json` holds slots `frontier` and `reviewer`, and the operator runs `/jev remove reviewer`
- **THEN** an error names `crew.slots` and asks to rename the `frontier` slot, and `config.json` is unchanged

#### Scenario: Legacy frontier slot still shows others
- **WHEN** `config.json` holds slots `frontier` and `reviewer`, and the operator runs `/jev reviewer`
- **THEN** the `reviewer` slot is shown

#### Scenario: Frontier is the switch
- **WHEN** the operator runs `/jev frontier off`
- **THEN** `state.json` holds `switches.frontier` `false` and `config.json` is unchanged

#### Scenario: Name-shaped typo of a feature
- **WHEN** the operator runs `/jev colors off`
- **THEN** an error says `off` is not a `provider/model`, the usage text is included, and `config.json` is unchanged

### Requirement: Order of slot checks
An add or replace SHALL run its checks in this order, after the invalid-config refusal and the legacy `frontier` slot refusal (see "Slot command forms"), which both come first: parsing, then the model's `provider/id` shape, then the `when` requirement, then the registry and credentials check, then the slot writer's rules. The first failure MUST be the only error reported.

#### Scenario: Legacy frontier slot reported first
- **WHEN** `config.json` holds a slot named `frontier` and the operator runs `/jev reviewer fixture/unknown`
- **THEN** the only error asks to rename the `frontier` slot

#### Scenario: Missing when reported before an unknown model
- **WHEN** no slot `reviewer` exists and the operator runs `/jev reviewer fixture/unknown`
- **THEN** the only error says a new slot needs `when`

#### Scenario: Bad model shape reported before missing when
- **WHEN** no slot `colors` exists and the operator runs `/jev colors off`
- **THEN** the only error says `off` is not a `provider/model`

