# package-loading Specification

## Purpose
The repository is a Pi package whose manifest names one extension entry point that Pi loads without error and that registers only the `/jev` command, the `jev_review` tool and a bounded set of event handlers.

## Requirements

### Requirement: Extension loads through a real install
Installing the repository checkout with `pi install` into an isolated `PI_CODING_AGENT_DIR` SHALL make Pi's resource loader report the package's `src/extension.ts` and `packages/pi-subagents/src/index.ts` as loaded extensions with no load errors. The check MUST NOT touch the operator's real agent directory, and MUST run offline with no credentials.

#### Scenario: Installed checkout is loaded
- **WHEN** the checkout is installed with the pinned `pi` CLI into a fresh temporary agent directory, with `PI_OFFLINE=1`, and `DefaultResourceLoader` reloads resources for that agent directory
- **THEN** `getExtensions().errors` is empty, exactly one loaded extension resolves to the checkout's `src/extension.ts`, and exactly one to `packages/pi-subagents/src/index.ts`

#### Scenario: A failing entry point is not reported as loaded
- **WHEN** a fixture package whose factory throws is installed the same way and the resource loader reloads
- **THEN** no extension resolves to that entry point and `errors` contains one entry naming its path

### Requirement: Extension registrations are bounded
The jev-pilot extension factory (`src/extension.ts`) SHALL register exactly one command, `jev`, exactly one tool, `jev_review`, and handlers for `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled` only, plus its subscriptions to the executor's `subagents:*` events on `pi.events`. It MUST NOT register `message_end`, `tool_call` or `tool_result` handlers. The vendored executor's registrations are not bound by this requirement. It MUST register no flags or shortcuts. Loading the package MUST make no network call and run no process, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the jev-pilot extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, its tools are exactly `jev_review`, its handlers are exactly `session_start`, `session_shutdown`, `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled`, and its flags and shortcuts are empty

### Requirement: Package manifest with the vendored executor
The repository root `package.json` SHALL declare a Pi package whose `pi.extensions` lists exactly `./packages/pi-subagents/src/index.ts` and `./src/extension.ts`, in that order, whose `keywords` include `pi-package`, and whose `license` is `MIT`. Its `peerDependencies` SHALL be exactly the host-provided packages that `src/` and the vendored executor import: `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` and `typebox`, each with the range `"*"`. None may be a runtime dependency. The package MUST have no runtime `dependencies`.

#### Scenario: Manifest names both entry points
- **WHEN** `package.json` is read
- **THEN** `pi.extensions` equals `["./packages/pi-subagents/src/index.ts", "./src/extension.ts"]`, `keywords` contains `pi-package`, and `license` is `MIT`

#### Scenario: Host package is a peer, not bundled
- **WHEN** `package.json` is read
- **THEN** `peerDependencies` equals `{ "@earendil-works/pi-ai": "*", "@earendil-works/pi-coding-agent": "*", "@earendil-works/pi-tui": "*", "typebox": "*" }`, and `dependencies` is absent or empty

#### Scenario: Every imported host package is declared
- **WHEN** the non-relative imports under `src/` and `packages/pi-subagents/src/` are listed, excluding `node:` built-ins, the vendored package's own `#src/` imports, and type-only imports of `@ttdua/pi-subagents`
- **THEN** each imported package name is a key of `peerDependencies`
