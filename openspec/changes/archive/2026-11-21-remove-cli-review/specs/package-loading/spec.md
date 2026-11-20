## MODIFIED Requirements

### Requirement: Extension registrations are bounded
<!-- Intentional change: the `jev_review` tool is removed; the scenario keeps its name and now expects no tool. -->
The jev-pilot extension factory (`src/extension.ts`) SHALL register exactly one command, `jev`, no tool, and handlers for `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled` only, plus its subscriptions to the executor's `subagents:*` events on `pi.events`. It MUST NOT register `message_end`, `tool_call` or `tool_result` handlers. It MUST register no flags or shortcuts. Loading the package MUST make no network call and run no process, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the jev-pilot extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, it has no tools, its handlers are exactly `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled`, and its flags and shortcuts are empty

