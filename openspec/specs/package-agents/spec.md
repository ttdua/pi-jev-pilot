# package-agents Specification

## Purpose
An installed pi package can ship agent files through one `package.json` key, `pi.subagents.agents`; the executor reads only packages pi has configured, keeps every path inside the package, respects project trust, and fails quiet.

## Requirements

### Requirement: Package agent manifest key
The executor SHALL read package agents only from the `package.json` key `pi.subagents.agents`, an array of strings, each a path relative to the package root. Any other shape or key, including a top-level `pi-subagents` key or an array given directly as `pi.subagents`, MUST contribute no agents.

#### Scenario: Declared directory loaded
- **WHEN** an installed package's `package.json` has `"pi": { "subagents": { "agents": ["./agents"] } }` and `agents/reviewer-x.md` exists in it
- **THEN** `listAgentTypes()` includes `reviewer-x` with `source` `package`

#### Scenario: Other spellings ignored
- **WHEN** a package declares only `"pi-subagents": { "agents": ["./agents"] }`, and another declares only `"pi": { "subagents": ["./agents"] }`
- **THEN** neither package contributes an agent

#### Scenario: Non-string entry
- **WHEN** `pi.subagents.agents` is `["./agents", 3]`
- **THEN** the package contributes no agent

### Requirement: Which packages are read
Package agents SHALL come only from the packages pi lists as configured (`DefaultPackageManager.listConfiguredPackages()` for the session's cwd), each install root read once. The executor MUST NOT scan `node_modules`. A project-scope package MUST be ignored while the project is not trusted (see "Project trust for package agents").

#### Scenario: Unconfigured package ignored
- **WHEN** a package with `pi.subagents.agents` sits in `node_modules` but is not in any pi `settings.json` `packages`
- **THEN** it contributes no agent

#### Scenario: Untrusted project package
- **WHEN** a package is configured only in the project's `.pi/settings.json` and the project is not trusted
- **THEN** it contributes no agent, and after the project becomes trusted the next `listAgentTypes()` includes its agents

#### Scenario: Package in both scopes
- **WHEN** the same install root is configured globally and in the project
- **THEN** its agents load once

### Requirement: Project trust for package agents
Project trust SHALL be the session's `isProjectTrusted()` once a session has started. Before that it SHALL be pi's saved trust decision for the cwd, and with no saved decision the global `defaultProjectTrust` setting being `always`.

#### Scenario: Saved trust before a session
- **WHEN** pi's trust store records the cwd as trusted and agents load before `session_start`
- **THEN** project-scope package agents are included

#### Scenario: Session answer wins
- **WHEN** the trust store records the cwd as trusted but the session reports `isProjectTrusted()` false
- **THEN** after `session_start` project-scope package agents are excluded

### Requirement: Paths stay inside the package
Each declared entry SHALL be resolved against the package root, with both paths canonicalised (following symlinks). An entry that resolves outside the package root, or that is not an existing directory, MUST contribute nothing. Each agent file SHALL be canonicalised before it is read, and a file that resolves outside the package root MUST be skipped. A refused entry or file MUST NOT stop the package's other agents from loading.

#### Scenario: Parent path refused
- **WHEN** `pi.subagents.agents` is `["../../.ssh", "./agents"]`
- **THEN** only the files in `./agents` load

#### Scenario: Symlink out of the package refused
- **WHEN** `./agents` inside the package is a symlink to a directory outside the package root
- **THEN** no agent loads from it

#### Scenario: Symlinked file out of the package skipped
- **WHEN** `./agents` is inside the package and holds `ok.md` and `leak.md`, where `leak.md` is a symlink to a file outside the package root
- **THEN** `ok` loads and `leak` does not

#### Scenario: Missing directory
- **WHEN** a declared directory does not exist
- **THEN** that entry contributes nothing and no error is shown

### Requirement: Package discovery fails quiet
Any failure while listing packages or reading a manifest (a missing pi API, unreadable settings, malformed `package.json`) SHALL yield no package agents for the affected packages. It MUST NOT throw from agent loading, and built-in, global and project agents SHALL still load.

#### Scenario: Malformed manifest
- **WHEN** a configured package's `package.json` is not valid JSON
- **THEN** that package contributes nothing and every other agent still loads

#### Scenario: Package API unavailable
- **WHEN** listing configured packages throws
- **THEN** `listAgentTypes()` returns the built-in, global and project agents
