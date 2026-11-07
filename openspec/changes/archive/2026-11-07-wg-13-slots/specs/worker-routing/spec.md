## MODIFIED Requirements

### Requirement: Worker request content
Each worker request SHALL use the agent read for the launch's `subagent_type`, the worker state from `input.prompt` and `input.description`, and the effective `run_in_background`. The display names for the `tier` criteria of tiers and slots (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`.

#### Scenario: Display name prefix
- **WHEN** `tiers.fast` names a registry model whose display name is `Fixture Fast`
- **THEN** the `fast` criterion in the request starts with `Fixture Fast. `

#### Scenario: Slot display name
- **WHEN** slot `reviewer` names a registry model whose display name is `Fixture Review`
- **THEN** the `slot::reviewer` criterion in the request starts with `Fixture Review (a custom model). `

#### Scenario: Parent request off
- **WHEN** `state.parentRequest` is off
- **THEN** the request state has no `parent_request`

#### Scenario: Forked launch with thinking asks fewer questions
- **WHEN** a launch inherits context and `subagents.forkedLaunch` is `thinking`
- **THEN** the request asks exactly `effort` and `risky`

### Requirement: Target check before writing
For a launch whose route can write a model (its request asks the `tier` question and `model` is not locked), routing SHALL check the model of every offered tier and slot: the `provider/id` MUST name a model in Pi's model registry, and that model MUST have configured credentials. A target failing either check SHALL count as unable to run for the fallback choice. Other launches MUST NOT be checked or warned about.

#### Scenario: Unknown model
- **WHEN** `tiers.deep` names a model the registry does not know, and Jev decides `deep`
- **THEN** `deep` counts as unable to run and the launch cascades down

#### Scenario: Missing credentials
- **WHEN** `tiers.deep` names a registry model without configured credentials, and Jev decides `deep`
- **THEN** `deep` counts as unable to run

#### Scenario: Unusable slot
- **WHEN** slot `reviewer` names a registry model without configured credentials, and Jev decides `slot::reviewer`
- **THEN** the slot counts as unable to run and the launch moves to `balanced`

#### Scenario: Model-locked launch not checked
- **WHEN** the agent locks `model` and `tiers.deep` has no credentials
- **THEN** no warning is shown for that launch

### Requirement: Fallback warning
When the decided target cannot run, routing SHALL warn through the UI, naming the target, its model, why it cannot run (`not in the model registry` or `no credentials`), the tier used instead or that the launch is left unchanged, and the setting to fix with the path of `config.json`: `tiers.<name>` for a tier, and `crew.slots "<name>" model` for a slot. A warning for the same target and model string MUST be shown at most once per session, until any `/jev` form runs (slot forms included) or that target's model string changes. No warning SHALL be drawn without a UI.

#### Scenario: Warning text
- **WHEN** `deep` has no credentials and the launch moves to `balanced`
- **THEN** one warning names `deep`, its model, `no credentials`, `balanced` and `tiers.deep`

#### Scenario: Slot warning text
- **WHEN** slot `reviewer` has no credentials and the launch moves to `balanced`
- **THEN** one warning names slot `reviewer`, its model, `no credentials`, `balanced` and `crew.slots "reviewer" model`

#### Scenario: Once per tier
- **WHEN** three launches in one session each cascade from `deep`
- **THEN** the warning is shown once

#### Scenario: Once per slot
- **WHEN** three launches in one session each fall back from `slot::reviewer`
- **THEN** the warning is shown once

#### Scenario: Nothing can run
- **WHEN** `balanced` is decided and neither `balanced` nor `fast` can run
- **THEN** one warning names `balanced` and says the launch is left unchanged

#### Scenario: Unknown model wording
- **WHEN** `tiers.deep` names a model the registry does not know and the launch cascades
- **THEN** the warning says `not in the model registry`

#### Scenario: Shown again after a model change
- **WHEN** a warning for `deep` was shown, `tiers.deep` is changed to another unusable model, and another launch cascades from `deep`
- **THEN** the warning is shown again

#### Scenario: No UI
- **WHEN** Pi runs without a UI and a launch cascades
- **THEN** no warning is drawn and the launch is still routed

#### Scenario: Slot warning with nothing to fall back to
- **WHEN** slot `reviewer` cannot run and neither `balanced` nor `fast` can run
- **THEN** one warning names slot `reviewer` and says the launch is left unchanged

#### Scenario: Slot warning shown again after its model changes
- **WHEN** a warning for slot `reviewer` was shown, its model is changed to another unusable model, and another launch falls back from `slot::reviewer`
- **THEN** the warning is shown again

#### Scenario: Slot warning shown again after a slot command
- **WHEN** a warning for slot `reviewer` was shown, the operator runs `/jev reviewer`, and another launch falls back from `slot::reviewer`
- **THEN** the warning is shown again

#### Scenario: Shown again after /jev
- **WHEN** a warning for `deep` was shown, `/jev` runs, and another launch cascades from `deep`
- **THEN** the warning is shown again

## ADDED Requirements

### Requirement: Reviewer slot routes
A launch whose brief Jev assigns to a configured slot at probability ≥ .6 SHALL run on that slot's model, with the thinking from the worker effort clamped to that model, in foreground and background launches alike. When Jev fails, the launch MUST keep the caller's input as for any launch.

#### Scenario: Review launch on the reviewer slot
- **WHEN** slot `reviewer` names a usable registry model, the main model launches a review worker, and Jev answers `tier` `slot::reviewer` at .92 with `effort` `high`
- **THEN** the child's first request uses the slot's model with reasoning effort `high`

#### Scenario: Background review launch
- **WHEN** the same review launch runs with `run_in_background` true
- **THEN** the child's first request uses the slot's model with reasoning effort `high`

#### Scenario: Unusable reviewer slot falls back
- **WHEN** slot `reviewer` has no credentials, `tiers.balanced` is usable, and Jev answers `tier` `slot::reviewer` at .92
- **THEN** the child's first request uses the `balanced` model, and one warning names `crew.slots "reviewer" model`

#### Scenario: Jev down with a slot configured
- **WHEN** slot `reviewer` is configured and Jev does not answer
- **THEN** the launch runs with the caller's input after at most `timeoutMs` of added wait
