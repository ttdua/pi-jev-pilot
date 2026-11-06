## REMOVED Requirements

### Requirement: Extension has no effect

**Reason**: WG-06 gives the extension its first visible behaviour: the `/jev` command, the status line and the child registry.

**Migration**: Replaced by "Extension registrations are bounded" below. `tests/load.test.ts` checks the new bounds instead of empty registrations.

## ADDED Requirements

### Requirement: Extension registrations are bounded
The extension factory SHALL register exactly one command, `jev`, and handlers for `session_start` and `session_shutdown` only, plus its subscriptions to the executor's child events on `pi.events`. It MUST register no tools, flags or shortcuts. Loading the package MUST make no network call, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, its handlers are exactly `session_start` and `session_shutdown`, and its tools, flags and shortcuts are empty
