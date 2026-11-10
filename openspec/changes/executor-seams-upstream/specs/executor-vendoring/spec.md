## ADDED Requirements

### Requirement: Vendored executor location
The repository SHALL hold the executor in `packages/pi-subagents/`, as a member of the root `workspaces`, with its own `package.json` whose `name` is `@ttdua/pi-subagents` and whose `private` is `true`. The vendored package MUST keep upstream's `imports` map, so its `#src/*` imports resolve inside the package.

#### Scenario: Workspace member
- **WHEN** the root `package.json` is read
- **THEN** `workspaces` contains `packages/pi-subagents`

#### Scenario: Not confused with the published package
- **WHEN** `packages/pi-subagents/package.json` is read
- **THEN** `name` is `@ttdua/pi-subagents` and `private` is `true`

### Requirement: Upstream provenance
`packages/pi-subagents/VENDORED.md` SHALL record the upstream repository, the package path in it, the upstream release tag and the upstream commit the vendored tree was last synced from. It SHALL list every local change: each added seam with its new files, and each upstream file edited with a one-line reason. An upstream file edited without an entry in `VENDORED.md` MUST fail a repository test.

#### Scenario: Initial provenance
- **WHEN** `VENDORED.md` is read after the first vendoring
- **THEN** it names `gotgenes/pi-packages`, `packages/pi-subagents`, the tag of release `25.0.5` and its commit

#### Scenario: Unlisted edit detected
- **WHEN** an upstream file in `packages/pi-subagents/` differs from the recorded upstream commit and `VENDORED.md` does not list it
- **THEN** the repository test fails and names that file

### Requirement: Upstream license kept
The vendored package SHALL keep upstream's `LICENSE` file unchanged. The root `NOTICE.md` SHALL name the vendored package, its upstream, its authors as stated in upstream's license and its license (`MIT`).

#### Scenario: Notice entry
- **WHEN** `NOTICE.md` is read
- **THEN** it has an entry for `packages/pi-subagents` naming `gotgenes/pi-packages` and `MIT`

### Requirement: One install loads both extensions
The root `package.json` `pi.extensions` SHALL list exactly `./packages/pi-subagents/src/index.ts` and then `./src/extension.ts`, in that order, so that one `pi install` of the repository loads the executor and jev-pilot, and the executor's `session_start` handler publishes its service before jev-pilot's `session_start` handler captures it.

#### Scenario: Both extensions loaded from one install
- **WHEN** the checkout is installed with the pinned `pi` CLI into a fresh temporary agent directory with `PI_OFFLINE=1`, and the resource loader reloads
- **THEN** `getExtensions().errors` is empty, one loaded extension resolves to `src/extension.ts`, one to `packages/pi-subagents/src/index.ts`, and the session's tools include `subagent`

### Requirement: Vendored tests run on their own
The vendored package SHALL keep its own unit tests and type check. A root script `test:executor` SHALL run them. The root `test` script MUST NOT run them, and jev-pilot's lint, type check, function-size rules and import-graph test MUST NOT cover `packages/`. The CI workflow SHALL run both `test` and `test:executor`.

#### Scenario: Executor suite runs from the root
- **WHEN** `bun run test:executor` runs on the committed tree
- **THEN** the vendored package's unit tests and type check run and exit with code 0

#### Scenario: jev-pilot checks skip the vendored tree
- **WHEN** `bun run lint` and `bun run typecheck` run
- **THEN** no file under `packages/` is checked

### Requirement: No runtime import across the two extensions
Code under `src/` MUST NOT import `packages/pi-subagents` at runtime. It MAY import types from it with `import type`. The two extensions SHALL communicate only through the executor service on `globalThis` and events on `pi.events`.

#### Scenario: Runtime import rejected
- **WHEN** a file under `src/` contains a value import from `@ttdua/pi-subagents` or from a path under `packages/`
- **THEN** the import-graph test fails and names that file

#### Scenario: Type import allowed
- **WHEN** a file under `src/` contains `import type` from `@ttdua/pi-subagents`
- **THEN** the import-graph test passes

### Requirement: Service identity and ownership
The vendored executor's published service SHALL carry `implementation` `"@ttdua/pi-subagents"` and the `sessionId` of the session whose extension instance published it. An instance SHALL publish its service when it loads, as upstream does, so consumers that read the service at load time (such as `@gotgenes/pi-subagents-worktrees`) keep working, but only when the slot does not already hold a service whose `implementation` is `@ttdua/pi-subagents`. The main session's instance loads before any child's, so children never replace it. Its `sessionId` SHALL be set at the instance's first `session_start`. An instance SHALL remove the service at shutdown only when the published service is still its own.

#### Scenario: Children do not replace the main service
- **WHEN** a main session starts, and two children are created and disposed
- **THEN** the service on `globalThis` is still the main session's, with `implementation` `@ttdua/pi-subagents`

#### Scenario: Load-time consumer finds the service
- **WHEN** a companion extension reads the service while it loads, after the vendored executor loaded
- **THEN** it finds the vendored service and can register its workspace provider

#### Scenario: Published before capture
- **WHEN** a main session starts, and again after a reload
- **THEN** jev-pilot's `session_start` finds the vendored service on `globalThis` and registers its launch policy

#### Scenario: Shutdown removes only its own service
- **WHEN** an instance shuts down while another instance's service is published
- **THEN** the other instance's service stays published
