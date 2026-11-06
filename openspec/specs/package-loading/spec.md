# package-loading Specification

## Purpose
The repository is a Pi package whose manifest names one extension entry point that Pi loads without error and that registers only the `/jev` command and its session handlers.

## Requirements

### Requirement: Package manifest
The repository root `package.json` SHALL declare a Pi package whose `pi.extensions` lists exactly `./src/extension.ts`, whose `keywords` include `pi-package`, whose `license` is `MIT`, and which declares `@earendil-works/pi-coding-agent` only as a `"*"` peer dependency, never as a runtime dependency. The package MUST have no runtime `dependencies`.

#### Scenario: Manifest names one entry point
- **WHEN** `package.json` is read
- **THEN** `pi.extensions` equals `["./src/extension.ts"]`, `keywords` contains `pi-package`, and `license` is `MIT`

#### Scenario: Host package is a peer, not bundled
- **WHEN** `package.json` is read
- **THEN** `peerDependencies["@earendil-works/pi-coding-agent"]` is `"*"`, and `dependencies` is absent or empty

### Requirement: Extension loads through a real install
Installing the repository checkout with `pi install` into an isolated `PI_CODING_AGENT_DIR` SHALL make Pi's resource loader report the package's `src/extension.ts` as a loaded extension with no load errors. The check MUST NOT touch the operator's real agent directory, and MUST run offline with no credentials.

#### Scenario: Installed checkout is loaded
- **WHEN** the checkout is installed with the pinned `pi` CLI into a fresh temporary agent directory, with `PI_OFFLINE=1`, and `DefaultResourceLoader` reloads resources for that agent directory
- **THEN** `getExtensions().errors` is empty and exactly one loaded extension resolves to the checkout's `src/extension.ts`

#### Scenario: A failing entry point is not reported as loaded
- **WHEN** a fixture package whose factory throws is installed the same way and the resource loader reloads
- **THEN** no extension resolves to that entry point and `errors` contains one entry naming its path

### Requirement: Extension registrations are bounded
The extension factory SHALL register exactly one command, `jev`, and handlers for `session_start` and `session_shutdown` only, plus its subscriptions to the executor's child events on `pi.events`. It MUST register no tools, flags or shortcuts. Loading the package MUST make no network call, and in print and JSON modes MUST NOT change Pi's output.

#### Scenario: Loaded extension registers only /jev and handlers
- **WHEN** the extension is loaded through the installed package
- **THEN** its commands are exactly `jev`, its handlers are exactly `session_start` and `session_shutdown`, and its tools, flags and shortcuts are empty
