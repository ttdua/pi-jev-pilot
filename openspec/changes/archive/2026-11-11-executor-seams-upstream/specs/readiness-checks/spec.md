## MODIFIED Requirements

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
