## MODIFIED Requirements

### Requirement: Extension registrations are bounded
The extension factory SHALL register exactly one command, `jev`, and handlers for `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled` only, plus its subscriptions to the executor's child events on `pi.events`. It MUST register no tools, flags or shortcuts. Loading the package MUST make no network call, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, its handlers are exactly `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled`, and its tools, flags and shortcuts are empty
