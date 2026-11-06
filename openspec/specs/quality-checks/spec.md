# quality-checks Specification

## Purpose
Type check, lint, format, tests and dependency-boundary rules, runnable locally and in CI without secrets or network beyond loopback.

## Requirements

### Requirement: Check commands
The package SHALL provide the scripts `typecheck`, `lint`, `fmt`, `fmt:check` and `test`, each run with `bun run <name>`, and each MUST exit non-zero when its check fails. None of them may need secrets, paid calls, or network beyond loopback once dependencies are installed.

#### Scenario: Clean tree passes every check
- **WHEN** `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` run on the committed tree
- **THEN** each exits with code 0

#### Scenario: Unformatted file fails the format check
- **WHEN** a source file is not formatted as oxfmt would write it
- **THEN** `bun run fmt:check` exits non-zero

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

### Requirement: Continuous integration
A CI workflow SHALL run, on every push and pull request, a frozen-lockfile install followed by the type check, lint, format check and tests. It MUST fail if any step fails, and MUST use no repository secrets.

#### Scenario: CI runs every check
- **WHEN** the workflow file is read
- **THEN** it triggers on `push` and `pull_request`, and its steps run `bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` in that order, with no reference to `secrets.`

### Requirement: License
The repository SHALL include an MIT `LICENSE` file at its root.

#### Scenario: License file present
- **WHEN** the repository root is listed
- **THEN** `LICENSE` exists and contains the MIT License text
