## ADDED Requirements

### Requirement: No runtime import of the executor
Code under `src/` MUST NOT import `@ttdua/pi-subagents` at runtime. It MAY import types from it with `import type`; the types come from the dev dependency `@ttdua/pi-subagents` (see `host-test-harness`). jev-pilot SHALL communicate with an executor only through the service on `globalThis` and events on `pi.events`.

#### Scenario: Runtime import rejected
- **WHEN** a file under `src/` contains a value import from `@ttdua/pi-subagents`
- **THEN** the import-graph test fails and names that file

#### Scenario: Type import allowed
- **WHEN** a file under `src/` contains `import type` from `@ttdua/pi-subagents`
- **THEN** the import-graph test passes

### Requirement: Old names gone from current docs
No current document in `docs/` SHALL present `twin`, `prompt_mode` or `inherit_context` as current behaviour. Exempt: dated evidence (`docs/evidence/`), archived changes, decision records (`docs/decisions/`), changelog entries, and sections that describe the deprecated aliases.

#### Scenario: Old names gone from current docs
- **WHEN** `docs/` is searched for `twin`, `prompt_mode` and `inherit_context`
- **THEN** every match is in an exempt document or in a section that describes the name as deprecated
