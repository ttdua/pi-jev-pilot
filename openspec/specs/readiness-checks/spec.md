# readiness-checks Specification

## Purpose
Each status refresh and `/jev` run reads the config and state again and checks, without any network call, whether the API key and the executor are present.

## Requirements

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
The executor check SHALL run in a main session after its extensions are bound, at the moment of the check, so extension load order does not change the result. It SHALL report one of three states:
- `duplicate`: the tool named `subagent` that Pi reports in `pi.getAllTools()` has a `sourceInfo` path outside this package's `packages/pi-subagents/`, or the service on `globalThis` exists and its `implementation` is not `@ttdua/pi-subagents`. The check SHALL keep the other extension's `sourceInfo` path, when Pi reports one, for the report.
- `present`: not `duplicate`, and the service captured at the main session's `session_start` has `implementation` `@ttdua/pi-subagents` and offers `registerLaunchPolicy`.
- `absent`: neither of the above holds.

Worker routing and tool assessment SHALL treat `duplicate` as `absent`. Pi refuses to start a session in which two extensions register a tool with the same name, so this package and `@gotgenes/pi-subagents` never run together; `duplicate` therefore covers a session where another `subagent` provider runs instead of, or beside a renamed copy of, the vendored executor (for example jev-pilot's extension installed without its executor next to the original package). The check MUST NOT claim more.

#### Scenario: Executor installed
- **WHEN** this package is installed and a main session has started
- **THEN** the executor is `present`

#### Scenario: Executor absent
- **WHEN** no installed extension registers a `subagent` tool
- **THEN** the executor is `absent`

#### Scenario: Original loaded first
- **WHEN** jev-pilot's extension runs without the vendored executor and `@gotgenes/pi-subagents` loads before it
- **THEN** the `subagent` tool's `sourceInfo` is the original's, the executor is `duplicate`, and the check names that path

#### Scenario: Original loaded last
- **WHEN** jev-pilot's extension runs without the vendored executor, `@gotgenes/pi-subagents` loads after it and publishes its own service
- **THEN** the service's `implementation` is not `@ttdua/pi-subagents`, and the executor is `duplicate`

#### Scenario: Both executors installed
- **WHEN** this package and `@gotgenes/pi-subagents` are both installed
- **THEN** Pi refuses to start the session and names the conflicting `subagent` tool, before any `/jev` check runs

#### Scenario: Present after children
- **WHEN** a main session started, and two workers were created and disposed
- **THEN** the executor is still `present`

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
