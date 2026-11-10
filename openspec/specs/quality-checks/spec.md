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
Lint SHALL report a `no-restricted-imports` error for every import written as the shortest relative path that breaks the dependency rules of `docs/architecture.md`, and MUST NOT report one for an allowed import. Other spellings of a forbidden import are caught by the resolved-path check (requirement *Layer rules are checked on resolved paths*), not necessarily by lint.

#### Scenario: Forbidden edges
- **WHEN** a file imports, by its shortest relative path, along one of these edges: `policy/` → anything outside `policy/` and `shared/`; `jev/` → `host/`, `store/` or `extension.ts`; `store/` → `host/`, `jev/`, `policy/` or `extension.ts`; `shared/` → anything outside `shared/`; `scripts/` → `src/host/` or `src/store/`; `extension.ts` → `policy/`, `jev/`, `store/` or `shared/`; `host/` → `extension.ts`
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

### Requirement: Capability folders are entered through their index
A direct subfolder of `src/host/` or `src/policy/` is a capability folder; it includes its nested folders, which go at most one level deep. The checks SHALL fail when a file in `src/` (the entry point included) or `scripts/` imports a file inside another capability folder by any path other than that folder's `index.ts`. The import is judged on the file it resolves to, whatever its spelling; type-only imports count, and text inside strings, templates and comments is not an import.

#### Scenario: Deep import into a sibling capability fails the checks
- **WHEN** a file in `src/host/main/` imports `../worker/routing.ts`
- **THEN** `bun run test` fails, naming the file and the import

#### Scenario: Any spelling of the same path fails the checks
- **WHEN** a file in `src/host/main/` imports `./../worker/routing.ts`, or imports `type` only from `../worker/routing.ts`
- **THEN** `bun run test` fails, naming the file and the import

#### Scenario: Only real imports are read
- **WHEN** a file holds `import("../worker/routing.ts")` inside a string, template or comment, and a type-only import between two strings that contain `/*` and `*/`
- **THEN** the check ignores the first and reads the second

#### Scenario: Deep import from the entry point fails the checks
- **WHEN** `src/extension.ts` imports `./host/main/start.ts`
- **THEN** `bun run test` fails

#### Scenario: A capability folder name of any form is covered
- **WHEN** a file in `src/host/main/` imports `../_internal/file.ts` or `../.internal/file.ts`
- **THEN** `bun run test` fails

#### Scenario: A nested index is not a capability entry point
- **WHEN** a file in `src/host/main/` imports `../worker/nested/index.ts`
- **THEN** `bun run test` fails

#### Scenario: Deep import from a nested folder fails the checks
- **WHEN** a file in `src/host/main/nested/` imports `../../worker/routing.ts`
- **THEN** `bun run test` fails

#### Scenario: Deep import into a capability of another layer fails the checks
- **WHEN** a file in `src/host/main/` imports `../../policy/main/outcome.ts`, or `src/host/setup.ts` imports `../policy/main/outcome.ts`
- **THEN** `bun run test` fails

#### Scenario: Deep import from a layer root, jev or scripts fails the checks
- **WHEN** `src/host/setup.ts` imports `./main/start.ts`, a file in `src/jev/` imports `../policy/worker/route.ts`, or a file in `scripts/` imports `src/policy/worker/route.ts`
- **THEN** `bun run test` fails

#### Scenario: Allowed capability imports pass
- **WHEN** every import respects the layer rules and is one of: another capability's `index.ts`; a file of the importer's own capability folder, including from or into a nested folder; a file at the root of `src/policy/`
- **THEN** the capability check reports nothing

#### Scenario: Tests may import capability internals
- **WHEN** a file under `tests/` imports `src/host/main/gate.ts`
- **THEN** neither the capability check nor lint reports that import

#### Scenario: Nesting deeper than one level fails the checks
- **WHEN** a `.ts` file exists two folders below a capability folder (for example `<cap>/a/b/x.ts`)
- **THEN** `bun run test` fails, naming that file

#### Scenario: The other layers stay flat
- **WHEN** a `.ts` file exists in a subfolder of `src/jev/`, `src/store/` or `src/shared/`
- **THEN** `bun run test` fails, naming that file

#### Scenario: Lint gives early feedback on the plain spelling
- **WHEN** a file in `src/host/main/` imports `../worker/routing.ts`
- **THEN** `bun run lint` also reports a `no-restricted-imports` error for that import

### Requirement: Layer rules are checked on resolved paths
The checks SHALL fail for every import whose resolved file breaks the dependency rules of `docs/architecture.md`, whatever its spelling, including an import of a file directly under `src/` that is not a layer or the entry point. The existing lint rules stay as early feedback.

#### Scenario: A policy file importing a non-layer module under src fails the checks
- **WHEN** a file in `src/policy/main/` imports `../../helper.ts`
- **THEN** `bun run test` fails

#### Scenario: An index import that breaks a layer rule fails the checks
- **WHEN** a file in `src/policy/main/` or `src/policy/main/nested/` imports a file of `host/`, `jev/` or `store/`, including a capability's `index.ts`
- **THEN** `bun run test` fails

#### Scenario: The current layer edges are unchanged
- **WHEN** the resolved-path check runs over the existing boundary fixtures under `tests/fixtures/boundaries/`
- **THEN** it reports exactly the `bad-` fixtures, as lint does

### Requirement: Relative imports take the shortest path
A relative import in `src/host/` or `src/policy/` MUST be written as the shortest relative path to its target, and every import in `src/` and `scripts/` MUST be relative with the file extension, or a bare package name. The checks SHALL fail otherwise, so a path's text names its target.

#### Scenario: A round trip through a folder fails the checks
- **WHEN** a file in `src/policy/main/` imports `../../policy/answers.ts`, or a file in `src/host/main/` imports `../main/gate.ts`
- **THEN** `bun run test` fails, naming the shortest path to use instead (`../answers.ts`, `./gate.ts`)

#### Scenario: Absolute, extensionless and non-literal imports fail the checks
- **WHEN** a file in `src/policy/main/` imports an absolute path into `src/host/`, a file in `src/host/main/` imports `../worker/index`, or a file imports a module through a non-literal `import(target)`
- **THEN** `bun run test` fails

#### Scenario: Canonical paths pass
- **WHEN** a file in `src/policy/main/` imports `../answers.ts` or `./skill.ts`, or a file in `src/host/main/` imports `./gate.ts` or `../worker/index.ts`
- **THEN** the checks report nothing for that import
