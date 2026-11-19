## MODIFIED Requirements

### Requirement: Worker request content
Each worker request SHALL be built from:
- the agent facts built from the launch request's agent snapshot;
- the worker state, from the launch request's `prompt` and `description`;
- its `isBackground`.

The display names for the `tier` criteria of tiers and slots (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`.

#### Scenario: Display name prefix
- **WHEN** `tiers.basic` names a registry model whose display name is `Fixture Basic`
- **THEN** the `basic` criterion in the request starts with `Fixture Basic. `

#### Scenario: Slot display name
- **WHEN** slot `reviewer` names a registry model whose display name is `Fixture Review`
- **THEN** the `slot::reviewer` criterion in the request starts with `Fixture Review (a custom model). `

#### Scenario: Parent request off
- **WHEN** `state.parentRequest` is off
- **THEN** the request state has no `parent_request`

#### Scenario: Forked launch with thinking asks fewer questions
- **WHEN** a launch's context is `fork` and `subagents.forkLaunch` is `thinking`
- **THEN** the request asks exactly `effort` and `risky`

#### Scenario: Service launch content
- **WHEN** an extension calls `spawn("implementer", brief, { description: "probe" })`
- **THEN** the worker request's agent is `implementer` and its state is built from `brief` and `probe`

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
- **THEN** the slot counts as unable to run and the launch moves to `broad`

#### Scenario: Model-locked launch not checked
- **WHEN** the agent locks `model` and `tiers.deep` has no credentials
- **THEN** no warning is shown for that launch

### Requirement: Fallback warning
When the decided target cannot run, routing SHALL warn through the UI, naming the target, its model, why it cannot run (`not in the model registry` or `no credentials`), the tier used instead or that the launch is left unchanged, and the setting to fix with the path of `config.json`: `tiers.<name>` for a tier, and `crew.slots "<name>" model` for a slot. A warning for the same target and model string MUST be shown at most once per session, until any `/jev` form runs (slot forms included) or that target's model string changes. No warning SHALL be drawn without a UI.

#### Scenario: Warning text
- **WHEN** `deep` has no credentials and the launch moves to `broad`
- **THEN** one warning names `deep`, its model, `no credentials`, `broad` and `tiers.deep`

#### Scenario: Slot warning text
- **WHEN** slot `reviewer` has no credentials and the launch moves to `broad`
- **THEN** one warning names slot `reviewer`, its model, `no credentials`, `broad` and `crew.slots "reviewer" model`

#### Scenario: Once per tier
- **WHEN** three launches in one session each cascade from `deep`
- **THEN** the warning is shown once

#### Scenario: Once per slot
- **WHEN** three launches in one session each fall back from `slot::reviewer`
- **THEN** the warning is shown once

#### Scenario: Nothing can run
- **WHEN** `broad` is decided and neither `broad` nor `basic` can run
- **THEN** one warning names `broad` and says the launch is left unchanged

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
- **WHEN** slot `reviewer` cannot run and neither `broad` nor `basic` can run
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

### Requirement: Mode of a launch
Routing SHALL read the mode once per launch, when its policy call builds the worker request, and MUST use that same mode for the launch's cut points and its ledger line. A mode change after the request is built MUST NOT affect that launch. A launch left untouched SHALL record the mode read when its policy call ran.

#### Scenario: Premium launch end to end
- **WHEN** the mode is `premium`, all four tiers are configured, the window uses the seed (whose `premium` `frontierMin` is at most 3), and Jev answers `tier` with probability `frontier` 1, and `effort` `low`
- **THEN** the request is the same as in `standard`, the child runs on `tiers.frontier` with reasoning effort `low` clamped to its model, and the ledger line has `mode` `premium`, `reason` `frontier`, `rubric` 3 and a `score` of 3

#### Scenario: Mode changed between message end and launch
- **WHEN** a worker request is built in `standard`, then `state.json` is changed to `premium` before the child session is created
- **THEN** the ledger line has `mode` `standard`

#### Scenario: Jev down in premium
- **WHEN** the mode is `premium` and Jev does not answer
- **THEN** the launch keeps the requested values, and the ledger line has `mode` `premium`, `reason` `miss` and no `score`

### Requirement: Reviewer slot routes
A launch whose brief Jev assigns to a configured slot at probability ≥ .6, and for which rule `frontier` does not match (see `worker-decision`), SHALL run on that slot's model, with the thinking from the worker effort clamped to that model, in foreground and background launches alike. When Jev fails, the launch MUST keep the caller's input as for any launch.

#### Scenario: Review launch on the reviewer slot
- **WHEN** slot `reviewer` names a usable registry model, the main model launches a review worker, and Jev answers `tier` `slot::reviewer` at .92 with `effort` `high`
- **THEN** the child's first request uses the slot's model with reasoning effort `high`

#### Scenario: Frontier wins over the reviewer slot
- **WHEN** slot `reviewer` and `tiers.frontier` name usable registry models, and Jev answers `tier` with probabilities `slot::reviewer` .6 and `frontier` .4 while the launch's `frontierMin` is at most 3
- **THEN** the child's first request uses the `frontier` model, and the ledger line has `reason` `frontier`

#### Scenario: Background review launch
- **WHEN** the same review launch runs with `run_in_background` true
- **THEN** the child's first request uses the slot's model with reasoning effort `high`

#### Scenario: Unusable reviewer slot falls back
- **WHEN** slot `reviewer` has no credentials, `tiers.broad` is usable, and Jev answers `tier` `slot::reviewer` at .92
- **THEN** the child's first request uses the `broad` model, and one warning names `crew.slots "reviewer" model`

#### Scenario: Jev down with a slot configured
- **WHEN** slot `reviewer` is configured and Jev does not answer
- **THEN** the launch runs with the caller's input after at most `timeoutMs` of added wait

### Requirement: Launches routing acts on
The policy SHALL return nothing, and ask Jev nothing, for a launch whose `parentSessionId` is a recorded child session (see `child-registry`). For a launch with `origin.kind` `service` and a set `requested.model`, routing SHALL treat `model` as locked in the worker request, the route and the ledger line, exactly as for an agent that locks only `model` (see `worker-decision` "Locks in the route"). Every other launch SHALL be routed.

#### Scenario: Launch from a worker
- **WHEN** a worker's own `subagent` call launches a nested worker
- **THEN** the policy returns nothing and no worker request is sent

#### Scenario: Service launch with an explicit model
- **WHEN** an extension calls `spawn("implementer", brief, { model: "fixture/fixture-deep" })`, and Jev answers `tier` `basic` and `effort` `high`
- **THEN** the child runs on `fixture/fixture-deep` with reasoning effort `high`, and the ledger line has `locked` true

#### Scenario: Service launch without a model
- **WHEN** an extension calls `spawn("implementer", brief)` and Jev's answers cut to `basic` with effort `medium`
- **THEN** the child runs on `tiers.basic` with reasoning effort `medium`
