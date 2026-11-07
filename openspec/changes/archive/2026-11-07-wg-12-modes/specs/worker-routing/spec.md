## ADDED Requirements

### Requirement: Mode of a launch
Routing SHALL read the mode once per launch, when its worker request is built, and MUST use that same mode for the request's questions, the tier decision and the launch's ledger line. A mode change after the request is built MUST NOT affect that launch. A launch left untouched or not asked SHALL record the mode read when it was classified.

#### Scenario: Premium launch end to end
- **WHEN** the mode is `premium`, all four tiers are configured, and Jev answers `tier` `deep` with `P(expert)` .3 and `effort` `xhigh`
- **THEN** the request carries the `premium` criteria, the child runs on `tiers.expert`, and the ledger line has `mode` `premium` and `reason` `expert-admitted`

#### Scenario: Mode changed between message end and launch
- **WHEN** a worker request is built in `standard`, then `state.json` is changed to `premium` before the `subagent` call runs
- **THEN** the decision uses the `standard` gate and the ledger line has `mode` `standard`

#### Scenario: Jev down in premium
- **WHEN** the mode is `premium` and Jev does not answer
- **THEN** the launch keeps the caller's input, and the ledger line has `mode` `premium` and `reason` `miss`
