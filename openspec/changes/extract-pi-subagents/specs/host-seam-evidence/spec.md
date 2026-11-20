## MODIFIED Requirements

### Requirement: Answers are pinned by host tests
Each host test for WG-02 questions 4 to 6 SHALL assert, as fixed expected values in the test, the values stated for that question in the evidence report, so that a change in Pi or executor behavior makes the test fail. A negative answer MUST be pinned the same way as a positive one. A question the report marks unsettled, superseded or moved is exempt. The Q4 host test SHALL run jev-pilot's extension together with the pinned executor (see `host-test-harness`).

#### Scenario: Changed host behavior fails the test
- **WHEN** a host test's observed value differs from the value stated in the evidence report
- **THEN** the test fails and names the question it covers

#### Scenario: Q4 runs with jev-pilot
- **WHEN** the Q4 host test starts its session
- **THEN** both jev-pilot's extension and the pinned executor are installed, and the test still names `WG-02 Q4`

### Requirement: Evidence report
The repository SHALL contain an evidence report in `docs/evidence/` giving, per WG-02 question, the answer, its supporting test or run, its testing level as named in `docs/testing.md`, and the tested versions. An answer MUST come from a run; a negative answer is an answer; a question no run settled MUST be marked unsettled with the reason. A question whose seam the package no longer uses SHALL be marked superseded, keep its recorded answer, and link the requirement that replaces it; a link to a requirement held by `ttdua/pi-subagents` SHALL be a URL into that repository. A question whose seam is executor behavior SHALL be marked moved, keep its recorded answer, and name `ttdua/pi-subagents` as where it is now tested. The report MUST NOT contain real prompts, session content, request bodies, secrets or account details.

#### Scenario: Every question answered or marked unsettled
- **WHEN** the report is read
- **THEN** each of the eight questions has an answer citing a test or run and a testing level, or is marked unsettled, superseded or moved with a reason

#### Scenario: Superseded questions kept
- **WHEN** the report is read after the launch policy replaced the `tool_call` and `message_end` seams
- **THEN** Q1, Q2 and Q7 are marked superseded, keep their answers, and link `executor-launch-policy` in `ttdua/pi-subagents` and jev-pilot's launch policy host test

#### Scenario: Q3 marked moved
- **WHEN** the report is read after the executor moved to its own repository
- **THEN** Q3 is marked moved, keeps its answer, names `ttdua/pi-subagents`, and cites no file under `tests/host/`

#### Scenario: Service launch escalation section marked moved
- **WHEN** the report's service launch escalation section is read
- **THEN** it keeps its recorded observations, is marked moved, and names `ttdua/pi-subagents`

## REMOVED Requirements

### Requirement: Child tool removal

**Reason**: Q3 tests the executor's child tool selection; this repository no longer runs executor-only sessions.

**Migration**: The answer stays in the evidence report, marked moved. The executor's tool boundaries are specified and tested in `ttdua/pi-subagents`.

### Requirement: Launch policy host evidence

**Reason**: These host tests install only the executor with a probe policy; they test executor behavior.

**Migration**: Covered by `ttdua/pi-subagents` (`executor-launch-policy`). jev-pilot's own launch policy remains covered by its host tests that run the installed checkout with the pinned executor (`worker-routing`).

### Requirement: Service launch escalation host evidence

**Reason**: The host test installs only the executor and a probe; it tests executor behavior.

**Migration**: Covered by `ttdua/pi-subagents` (`service-launch-wait`). The evidence report keeps the recorded section, marked moved.
