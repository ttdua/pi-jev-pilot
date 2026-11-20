## MODIFIED Requirements

### Requirement: Extensions under test are installed by a real install
<!-- Intentional change: jev-pilot registers no tool, so the install scenarios no longer use `jev_review` as the sign that jev-pilot loaded; "jev-pilot without an executor" checks the `/jev` executor line instead. -->
The harness SHALL install, with `pi install`, into the isolated agent directory: the pinned executor (see "Executor comes from the pinned dev dependency") unless the test asks for no executor, then this repository's checkout, then each probe extension a test names, in that order; and SHALL write the agent definition files a test supplies into that directory before the session starts. Every install MUST succeed with `PI_OFFLINE=1` and no network beyond loopback. The harness MUST NOT offer an install that loads the executor without jev-pilot's extension. A test MAY ask for no package at all, for probes that check Pi itself.

#### Scenario: Executor installs offline
- **WHEN** the harness installs the pinned executor and the checkout with `PI_OFFLINE=1`
- **THEN** both installs exit with code 0

#### Scenario: Executor and probe are loaded
- **WHEN** a host test asks for the executor and one probe
- **THEN** the session's tools include `subagent`, and the probe's handlers run during the session

#### Scenario: Probes only
- **WHEN** a host test asks for no package and one probe
- **THEN** the session's tools do not include `subagent`, and the probe's handlers run

#### Scenario: jev-pilot without an executor
- **WHEN** a host test asks for no executor
- **THEN** the session's tools include no `subagent`, and `/jev` reports `executor: no executor; worker routing is off`

