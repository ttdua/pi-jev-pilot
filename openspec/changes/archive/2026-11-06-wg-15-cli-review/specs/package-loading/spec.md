## MODIFIED Requirements

### Requirement: Extension registrations are bounded
The extension factory SHALL register exactly one command, `jev`, exactly one tool, `jev_review`, and handlers for `session_start`, `session_shutdown` and `before_agent_start` only, plus its subscriptions to the executor's child events on `pi.events`. It MUST register no flags or shortcuts. Loading the package MUST make no network call and run no process, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, its tools are exactly `jev_review`, its handlers are exactly `session_start`, `session_shutdown` and `before_agent_start`, and its flags and shortcuts are empty
