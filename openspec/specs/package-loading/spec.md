# package-loading Specification

## Purpose
The repository is a Pi package whose manifest names one extension entry point that Pi loads without error and that registers only the `/jev` command and a bounded set of event handlers.

## Requirements

### Requirement: Extension loads through a real install
Installing the repository checkout with `pi install` into an isolated `PI_CODING_AGENT_DIR` SHALL make Pi's resource loader report the package's `src/extension.ts` as its only loaded extension, with no load errors. The check MUST NOT touch the operator's real agent directory, and MUST run offline with no credentials.

#### Scenario: Installed checkout is loaded
- **WHEN** the checkout is installed with the pinned `pi` CLI into a fresh temporary agent directory, with `PI_OFFLINE=1`, and `DefaultResourceLoader` reloads resources for that agent directory
- **THEN** `getExtensions().errors` is empty, exactly one loaded extension resolves to the checkout's `src/extension.ts`, and no loaded extension resolves inside the checkout outside `src/`

#### Scenario: A failing entry point is not reported as loaded
- **WHEN** a fixture package whose factory throws is installed the same way and the resource loader reloads
- **THEN** no extension resolves to that entry point and `errors` contains one entry naming its path

### Requirement: Extension registrations are bounded
<!-- Intentional change: the `jev_review` tool is removed; the scenario keeps its name and now expects no tool. -->
The jev-pilot extension factory (`src/extension.ts`) SHALL register exactly one command, `jev`, no tool, and handlers for `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled` only, plus its subscriptions to the executor's `subagents:*` events on `pi.events`. It MUST NOT register `message_end`, `tool_call` or `tool_result` handlers. It MUST register no flags or shortcuts. Loading the package MUST make no network call and run no process, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the jev-pilot extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, it has no tools, its handlers are exactly `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled`, and its flags and shortcuts are empty

### Requirement: Package manifest
The repository root `package.json` SHALL declare a Pi package `@ttdua/pi-jev-pilot` (license `MIT`, keyword `pi-package`) whose `pi.extensions` lists exactly `./src/extension.ts`, with no `workspaces`. Its `peerDependencies` SHALL be exactly the four host packages named in the scenario, each `"*"`, covering every host package `src/` imports. It MUST have no runtime `dependencies` and MUST NOT name an executor package outside `devDependencies`.

#### Scenario: Manifest names one entry point
- **WHEN** `package.json` is read
- **THEN** `name` is `@ttdua/pi-jev-pilot`, `pi.extensions` equals `["./src/extension.ts"]`, `workspaces` is absent, `keywords` contains `pi-package`, and `license` is `MIT`

#### Scenario: Host package is a peer, not bundled
- **WHEN** `package.json` is read
- **THEN** `peerDependencies` equals `{ "@earendil-works/pi-ai": "*", "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-tui": "*", "typebox": "*" }`, and `dependencies` is absent or empty

#### Scenario: Executor is a dev dependency only
- **WHEN** `package.json` is read
- **THEN** `@ttdua/pi-subagents` appears only in `devDependencies`, and neither `@ttdua/pi-subagents` nor `@gotgenes/pi-subagents` appears in `dependencies`, `peerDependencies` or `optionalDependencies`

#### Scenario: Every imported host package is declared
- **WHEN** the non-relative imports under `src/` are listed, excluding `node:` built-ins and type-only imports of `@ttdua/pi-subagents`
- **THEN** each imported package name is a key of `peerDependencies`
