# host-test-harness Specification

## Purpose
Real Pi CLI sessions in an isolated agent directory, with the pinned executor and a recording loopback provider, so host tests can assert what reaches the provider.

## Requirements

### Requirement: Isolated host session
The harness SHALL start the pinned `pi` CLI in RPC mode with `PI_CODING_AGENT_DIR` set to a fresh temporary directory, `PI_OFFLINE=1` and a fresh temporary working directory, and MUST remove those directories when the test ends. It MUST NOT read or write the operator's real agent directory, and MUST need no credentials and no network beyond loopback.

#### Scenario: Session runs in a fresh agent directory
- **WHEN** a host test starts a session through the harness
- **THEN** the CLI process has `PI_CODING_AGENT_DIR` pointing at a newly created temporary directory, and that directory no longer exists after the test

#### Scenario: Prompt completes against the fixture
- **WHEN** a host test sends one `prompt` command and the fixture scripts a text reply
- **THEN** the harness reports the run as settled and the fixture has recorded exactly one request

### Requirement: Recording loopback provider
The harness SHALL provide an HTTP server bound to `127.0.0.1` that implements streaming OpenAI chat completions, is registered as a provider in the isolated agent directory's `models.json`, and records the full body and arrival order of every request it receives. Recorded request bodies MUST stay in the test process and MUST NOT be written to the repository.

#### Scenario: Request fields are recorded
- **WHEN** Pi sends a request to the fixture
- **THEN** the test can read that request's `model`, `messages`, `tools` and `reasoning_effort` fields exactly as sent

#### Scenario: Tier models expose model and thinking
- **WHEN** the fixture provider is declared in `models.json`
- **THEN** it declares at least two reasoning models named by tier with OpenAI-style thinking, so that a request names its model in `model` and its thinking level in `reasoning_effort`

#### Scenario: Server binds loopback only
- **WHEN** the fixture starts
- **THEN** it listens on `127.0.0.1` on an operating-system-assigned port, and the `models.json` `baseUrl` uses that port

### Requirement: Scripted replies matched by request
The fixture SHALL answer each request from a test-supplied script whose entries are text replies or tool-call replies, selecting an entry by a matcher on the request so that concurrent main and child sessions each receive their intended reply. A request that no entry matches MUST receive an error response and be recorded as unmatched.

#### Scenario: Tool call launches a child
- **WHEN** the script answers the main session's request with a `subagent` tool call and answers requests for the child's model with text
- **THEN** the executor launches the child, and the fixture records one request from the main session and at least one from the child

#### Scenario: Unmatched request is visible
- **WHEN** a request matches no script entry
- **THEN** the fixture returns an error response and the test can read that request in the unmatched list

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

### Requirement: Probe report channel
The harness SHALL give each session a report file path through an environment variable, and probe extensions SHALL append one JSON object per line to it. Probe reports MUST contain only identifiers, event names, counters and timestamps, never prompt text, tool arguments or tool output.

#### Scenario: Probe events are readable after the run
- **WHEN** a probe appends records during a session
- **THEN** the test reads them, in write order, after the run settles

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
