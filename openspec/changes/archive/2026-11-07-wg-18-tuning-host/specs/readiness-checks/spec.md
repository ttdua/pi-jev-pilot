## MODIFIED Requirements

### Requirement: Snapshot from the files
Each status refresh and each `/jev` run SHALL read `config.json`, `state.json` and `tuning.json` again and resolve the effective settings with the tuning layer, without keeping settings between refreshes. The snapshot MUST keep the kind of the tuning read (`ok`, `missing`, `malformed` or `unreadable`) and its problems, and the untuned `timeoutMs` (the config value, or the default). When the config is invalid, the switches and mode MUST still be resolved from the state over the code defaults, the config problems MUST be kept for the report, and the key check MUST use the default variable `TYPESAFE_API_KEY`. A malformed or unreadable `tuning.json` MUST contribute no tuned value, and while the config is invalid the tuning layer MUST be ignored.

#### Scenario: Hand edit picked up
- **WHEN** the operator edits `state.json` by hand to set the mode to `budget` and then runs `/jev`
- **THEN** the report shows mode `budget`

#### Scenario: Invalid config keeps switches
- **WHEN** `config.json` is invalid and `state.json` turns `skills` off
- **THEN** the snapshot marks the config as invalid and still has `skills` off

#### Scenario: Invalid config uses the default key variable
- **WHEN** `config.json` is invalid and `TYPESAFE_API_KEY` is set
- **THEN** the snapshot reports the key as set

#### Scenario: Tuned value in the snapshot
- **WHEN** the config does not set `classifier.timeoutMs` and `tuning.json` holds value 1700 with base 1500
- **THEN** the snapshot's `classifier.timeoutMs` is 1700, its untuned `timeoutMs` is 1500 and its tuning read is `ok`

#### Scenario: Tuning ignored with an invalid config
- **WHEN** `config.json` is invalid and `tuning.json` holds value 1700 with base 1500
- **THEN** the snapshot's `classifier.timeoutMs` is 1500

#### Scenario: Malformed tuning ignored
- **WHEN** `tuning.json` is truncated
- **THEN** the snapshot's `classifier.timeoutMs` is the untuned value, and its tuning read is `malformed` with a problem at `""`
