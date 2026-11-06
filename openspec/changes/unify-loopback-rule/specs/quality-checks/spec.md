## MODIFIED Requirements

### Requirement: Dependency boundaries are enforced by lint
Lint SHALL report a `no-restricted-imports` error for every import that breaks the dependency rules of `docs/architecture.md`, and MUST NOT report one for an allowed import.

#### Scenario: Forbidden edges
- **WHEN** a file imports along one of these edges: `policy/` → anything outside `policy/` and `shared/`; `jev/` → `host/`, `store/` or `extension.ts`; `store/` → `host/`, `jev/`, `policy/` or `extension.ts`; `shared/` → anything outside `shared/`; `scripts/` → `src/host/` or `src/store/`; `extension.ts` → `policy/`, `jev/`, `store/` or `shared/`; `host/` → `extension.ts`
- **THEN** lint reports a `no-restricted-imports` error for that import

#### Scenario: Each forbidden edge is reported
- **WHEN** lint runs with the project configuration over fixture files that each contain one forbidden import
- **THEN** every fixture file gets a `no-restricted-imports` error

#### Scenario: Allowed edges are not reported
- **WHEN** lint runs with the project configuration over fixture files containing only allowed imports (`host/` importing `jev/`, `policy/`, `store/`, `shared/` and Pi; `jev/` importing `policy/` and `shared/`; `policy/` importing `shared/`; `store/` importing `shared/`; `scripts/` importing `src/jev/`, `src/policy/` and `src/shared/`; `extension.ts` importing `host/`)
- **THEN** none of them gets a `no-restricted-imports` error

### Requirement: Pi imports are confined to host
Lint SHALL report a `no-restricted-imports` error when any module other than `host/` imports `@earendil-works/*`.

#### Scenario: Pi import outside host is reported
- **WHEN** a file in `policy/`, `jev/`, `store/`, `shared/`, `scripts/` or `extension.ts` imports `@earendil-works/pi-coding-agent`
- **THEN** lint reports a `no-restricted-imports` error
