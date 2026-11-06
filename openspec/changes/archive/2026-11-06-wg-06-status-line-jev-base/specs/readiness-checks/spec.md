## ADDED Requirements

### Requirement: Key presence
The key check SHALL report the key as set exactly when the environment variable named by the effective `classifier.apiKeyEnv` holds a non-empty string. It MUST read the variable at check time, MUST NOT store, log or display the value, and MUST NOT call Jev to validate it.

#### Scenario: Default variable set
- **WHEN** `TYPESAFE_API_KEY` is a non-empty string and the config does not set `classifier.apiKeyEnv`
- **THEN** the key is set

#### Scenario: Configured variable
- **WHEN** the config sets `classifier.apiKeyEnv` to `MY_JEV_KEY`, `MY_JEV_KEY` is set and `TYPESAFE_API_KEY` is not
- **THEN** the key is set

#### Scenario: Empty value
- **WHEN** the variable holds an empty string
- **THEN** the key is not set

### Requirement: Executor presence
The executor check SHALL report the executor as present exactly when Pi's tool list contains a tool named `subagent`. It MUST be evaluated at the moment of the check, not when the extension loads, so extension load order does not change the result.

#### Scenario: Executor installed
- **WHEN** `@gotgenes/pi-subagents` is installed and a main session has started
- **THEN** the executor is present

#### Scenario: Executor absent
- **WHEN** no installed extension registers a `subagent` tool
- **THEN** the executor is absent

### Requirement: Snapshot from the files
Each status refresh and each `/jev` run SHALL read `config.json` and `state.json` again and resolve the effective settings, without keeping settings between refreshes. When the config is invalid, the switches and mode MUST still be resolved from the state over the code defaults, the config problems MUST be kept for the report, and the key check MUST use the default variable `TYPESAFE_API_KEY`.

#### Scenario: Hand edit picked up
- **WHEN** the operator edits `state.json` by hand to set the mode to `budget` and then runs `/jev`
- **THEN** the report shows mode `budget`

#### Scenario: Invalid config keeps switches
- **WHEN** `config.json` is invalid and `state.json` turns `skills` off
- **THEN** the snapshot marks the config as invalid and still has `skills` off

#### Scenario: Invalid config uses the default key variable
- **WHEN** `config.json` is invalid and `TYPESAFE_API_KEY` is set
- **THEN** the snapshot reports the key as set
