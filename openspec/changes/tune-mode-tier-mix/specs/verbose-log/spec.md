## MODIFIED Requirements

### Requirement: Worker log line segments
After its head, a `worker` line SHALL add, each segment only when it applies and in this order: ` · <s>s` from `ms`; ` · p <key> <p> …` from `tierP` (two decimals; `fast`, `balanced`, `deep`, `expert`, then other keys in line order); ` · why <reason>` unless the reason is `cut`, `choice` or `untouched`; ` · miss <miss>`; ` · fallback <fallback>` when it differs from a present `tier`; ` · locked` when `locked` is `true`; ` · <status>` unless `completed`.

#### Scenario: Worker fallback text
- **WHEN** the data is a `worker` line for agent `general-purpose` with `reason` `choice`, `tier` `balanced`, `fallback` `deep`, `effort` `high`, `ms` 480, `tierP` `{fast:0.1,balanced:0.3,deep:0.6}` and `status` `completed`
- **THEN** the text reads `jev · general-purpose → balanced · high · 0.5s · p fast 0.10 balanced 0.30 deep 0.60 · fallback deep`

#### Scenario: Worker miss text
- **WHEN** the data is a `worker` line for agent `scout` with `reason` `miss`, `miss` `timeout`, `ms` 1500, no `tier`, no `effort` and `status` `completed`
- **THEN** the text reads `jev · scout → - · - · 1.5s · why miss · miss timeout`

#### Scenario: Worker untouched text
- **WHEN** the data is a `worker` line for agent `scout` with `reason` `untouched`, no `tier`, no `effort` and `status` `aborted`
- **THEN** the text reads `jev · scout → untouched · - · aborted`

#### Scenario: Cut reason hidden
- **WHEN** the data is a `worker` line for agent `worker` with `reason` `cut`, `tier` `balanced`, `effort` `high`, `ms` 300 and `status` `completed`
- **THEN** the text reads `jev · worker → balanced · high · 0.3s` with no `why` segment

#### Scenario: Expert reason shown
- **WHEN** the data is a `worker` line with `reason` `expert` and `tier` `expert`
- **THEN** the text contains ` · why expert`
