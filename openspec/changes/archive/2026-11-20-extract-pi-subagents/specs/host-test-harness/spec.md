## MODIFIED Requirements

### Requirement: Extensions under test are installed by a real install
The harness SHALL install, with `pi install`, into the isolated agent directory: the pinned executor (see "Executor comes from the pinned dev dependency") unless the test asks for no executor, then this repository's checkout, then each probe extension a test names, in that order; and SHALL write the agent definition files a test supplies into that directory before the session starts. Every install MUST succeed with `PI_OFFLINE=1` and no network beyond loopback. The harness MUST NOT offer an install that loads the executor without jev-pilot's extension. A test MAY ask for no package at all, for probes that check Pi itself.

#### Scenario: Executor installs offline
- **WHEN** the harness installs the pinned executor and the checkout with `PI_OFFLINE=1`
- **THEN** both installs exit with code 0

#### Scenario: Executor and probe are loaded
- **WHEN** a host test asks for the executor and one probe
- **THEN** the session's tools include `subagent` and `jev_review`, and the probe's handlers run during the session

#### Scenario: Probes only
- **WHEN** a host test asks for no package and one probe
- **THEN** the session's tools include neither `subagent` nor `jev_review`, and the probe's handlers run

#### Scenario: jev-pilot without an executor
- **WHEN** a host test asks for no executor
- **THEN** the session's tools include `jev_review` and no `subagent`

## REMOVED Requirements

### Requirement: Executor comes from the vendored package

**Reason**: The vendored package is gone.

**Migration**: Replaced by "Executor comes from the pinned dev dependency".

## ADDED Requirements

### Requirement: Executor comes from the pinned dev dependency
The executor for type checks and host tests SHALL come only from the dev dependency `@ttdua/pi-subagents`, pinned in `devDependencies` to an exact release tag of `github:ttdua/pi-subagents` and locked in `bun.lock`. The harness SHALL install it from its directory under `node_modules`. `tsconfig.json` MUST NOT map `@ttdua/pi-subagents` to a path, and `@gotgenes/pi-subagents` MUST NOT appear in any dependency field.

#### Scenario: Pinned to a release tag
- **WHEN** `package.json` is read
- **THEN** `devDependencies["@ttdua/pi-subagents"]` matches `github:ttdua/pi-subagents#v<major>.<minor>.<patch>`

#### Scenario: Harness installs the resolved package
- **WHEN** a host test asks for the executor
- **THEN** the harness runs `pi install` on the directory of `@ttdua/pi-subagents` under `node_modules`, and the session's `subagent` tool comes from it

#### Scenario: No published executor dependency
- **WHEN** `package.json` is read
- **THEN** no dependency field names `@gotgenes/pi-subagents`, and `dependencies` is absent or empty

#### Scenario: Lockfile matches
- **WHEN** `bun install --frozen-lockfile` runs on the committed tree
- **THEN** it exits with code 0
