## ADDED Requirements

### Requirement: Executor comes from the vendored package
The executor SHALL come only from `packages/pi-subagents/`. The root `package.json` MUST NOT list `@gotgenes/pi-subagents` in any dependency field, and the package MUST still have no runtime `dependencies`.

#### Scenario: No published executor dependency
- **WHEN** `package.json` is read
- **THEN** no dependency field names `@gotgenes/pi-subagents`, and `dependencies` is absent or empty

#### Scenario: Lockfile matches
- **WHEN** `bun install --frozen-lockfile` runs on the committed tree
- **THEN** it exits with code 0

## MODIFIED Requirements

### Requirement: Extensions under test are installed by a real install
The harness SHALL install this repository's checkout, which brings the vendored executor (see `executor-vendoring`), and each probe extension a test names into the isolated agent directory with `pi install`, and SHALL write the agent definition files a test supplies into that directory before the session starts. The install MUST succeed with `PI_OFFLINE=1` and no network beyond loopback, from the checkout or from a tarball packed from it. A test that needs the executor without jev-pilot SHALL install a fixture package whose manifest lists only `packages/pi-subagents/src/index.ts`.

#### Scenario: Executor installs offline
- **WHEN** the harness installs the checkout with `PI_OFFLINE=1`
- **THEN** the install exits with code 0

#### Scenario: Executor and probe are loaded
- **WHEN** a host test asks for the executor and one probe
- **THEN** the session's tools include `subagent` and the probe's handlers run during the session

## REMOVED Requirements

### Requirement: Pinned executor
**Reason**: The executor is vendored in `packages/pi-subagents/`; there is no published package to pin.
**Migration**: "Executor comes from the vendored package", and `executor-vendoring` for the upstream version.
