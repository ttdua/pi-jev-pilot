## MODIFIED Requirements

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
