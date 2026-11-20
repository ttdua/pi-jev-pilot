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
The executor check SHALL run in a main session after its extensions are bound, at the moment of the check, so extension load order does not change the result. It SHALL read the tool list from `pi.getAllTools()` and the service captured at the main session's `session_start` from the executor slot (`Symbol.for("@gotgenes/pi-subagents:service")` on `globalThis`), and report one of two states:
- `absent`: no tool named `subagent` and no object service captured.
- `present`: otherwise, with three facts read from the captured service: `implementation` (its `implementation` when that is a non-empty string, else unknown), `launchPolicy` (its `registerLaunchPolicy` is a function) and `agentRegistry` (its `listAgentTypes` is a function). With no object service captured, both capabilities are false.

The check MUST NOT depend on the executor's install path or on its `implementation` value. Worker routing SHALL run only when the executor is `present` with `launchPolicy`. The agent list SHALL be read only when the executor is `present` with `agentRegistry`. Reading the slot or a property that throws MUST count as that fact being false, and MUST NOT throw from the check.

#### Scenario: Executor installed
- **WHEN** `ttdua/pi-subagents` is installed and a main session has started
- **THEN** the executor is `present` with implementation `@ttdua/pi-subagents`, `launchPolicy` and `agentRegistry`

#### Scenario: Executor absent
- **WHEN** no installed extension registers a `subagent` tool or publishes a service
- **THEN** the executor is `absent`

#### Scenario: Original loaded first
- **WHEN** jev-pilot's extension runs with `@gotgenes/pi-subagents` 25.0.5 loaded before it, whose service has no `implementation`, no `registerLaunchPolicy` and no `listAgentTypes`
- **THEN** the executor is `present` with implementation unknown, `launchPolicy` false and `agentRegistry` false, and worker routing does not run

#### Scenario: Original loaded last
- **WHEN** jev-pilot's extension runs with `@gotgenes/pi-subagents` loaded after it
- **THEN** the result is the same as when it loads first, because the check reads the slot after extensions are bound

#### Scenario: Both executors installed
- **WHEN** `ttdua/pi-subagents` and `@gotgenes/pi-subagents` are both installed
- **THEN** Pi refuses to start the session and names the conflicting `subagent` tool, before any `/jev` check runs; this is Pi's own behavior, recorded here and not host-tested by this repository

#### Scenario: Another compatible executor
- **WHEN** an executor whose service has `implementation` `example-executor`, `registerLaunchPolicy` and `listAgentTypes` is installed
- **THEN** the executor is `present` with that implementation and both capabilities, and worker routing runs

#### Scenario: Tool without a service
- **WHEN** an extension registers a `subagent` tool and publishes no service
- **THEN** the executor is `present` with unknown implementation and both capabilities false

#### Scenario: Present after children
- **WHEN** a main session started, and two workers were created and disposed
- **THEN** the executor is still `present` with the same facts

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
