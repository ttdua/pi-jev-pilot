# host-seam-evidence Specification

## Purpose
Evidence from real runs for each WG-02 host-seam question, pinned by host tests and recorded in the evidence report, with documents kept in agreement.

## Requirements

### Requirement: Answers are pinned by host tests
Each host test for WG-02 questions 4 to 6 SHALL assert, as fixed expected values in the test, the values stated for that question in the evidence report, so that a change in Pi or executor behavior makes the test fail. A negative answer MUST be pinned the same way as a positive one. A question the report marks unsettled, superseded or moved is exempt. The Q4 host test SHALL run jev-pilot's extension together with the pinned executor (see `host-test-harness`).

#### Scenario: Changed host behavior fails the test
- **WHEN** a host test's observed value differs from the value stated in the evidence report
- **THEN** the test fails and names the question it covers

#### Scenario: Q4 runs with jev-pilot
- **WHEN** the Q4 host test starts its session
- **THEN** both jev-pilot's extension and the pinned executor are installed, and the test still names `WG-02 Q4`

### Requirement: Child session detection
A host test SHALL establish whether an extension subscribed to `subagents:child:session-created` on `pi.events` receives it before the child's extension handlers run, with a session id equal to the child's `ctx.sessionManager.getSessionId()`.

#### Scenario: Event precedes child handlers with matching id
- **WHEN** a probe records the event's session id and its arrival order, and the child's `session_start` handler records its own session id and order
- **THEN** the test asserts whether the ids match and whether the event arrived first, as recorded

### Requirement: Hidden context message
A host test SHALL establish whether a `before_agent_start` message with `display: false` appears in that turn's provider request, and whether it is present in requests after a compaction.

#### Scenario: Message reaches the provider
- **WHEN** a probe returns a hidden message carrying a synthetic marker
- **THEN** the test asserts whether the turn's first request contains the marker, as recorded

#### Scenario: After compaction
- **WHEN** the session is compacted, with the fixture scripting the summary reply, and a new prompt is sent
- **THEN** the test asserts whether the next request contains the marker, as recorded

### Requirement: Same-turn thinking level
A host test SHALL establish whether `pi.setThinkingLevel` called inside `before_agent_start` applies to that turn's first provider request.

#### Scenario: Level set before the first request
- **WHEN** a probe sets a thinking level different from the session's current level in `before_agent_start`
- **THEN** the test asserts the `reasoning_effort` of that turn's first request equals the recorded answer

### Requirement: Thinking change on claude-code
A manual script SHALL run a short controlled session on `claude-code/claude-haiku-5-5` in an isolated agent directory with `pi-claude-code` installed at commit `47f9e2b`, change the thinking level mid-session, and print per-turn thinking level, thinking-level events and cache token counts, plus the run date and versions. It MUST use fixed synthetic prompts and MUST print no prompt text, response text or account details.

#### Scenario: Script is not part of CI
- **WHEN** `bun run test` runs
- **THEN** the manual script does not run, because its file name does not match the `*.test.ts` pattern and no package script references it

#### Scenario: Run records cache behavior around a level change
- **WHEN** the operator runs the script with a working `claude-code` login
- **THEN** it prints, for each turn before and after the level change, the level, the events seen and the cache read and write counts, followed by the run date and versions

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

### Requirement: Documents agree with the evidence
When an answer contradicts `docs/architecture.md`, `docs/roadmap.md`, `docs/testing.md` or another document, that document SHALL be updated in the same change, and the host seams table SHALL no longer mark as **Verify** any seam the evidence settled. The roadmap SHALL show WG-02 as done and name any later work group an answer changed.

#### Scenario: No settled seam left as verify
- **WHEN** the host seams table is read after the change
- **THEN** every seam covered by a settled answer shows the answer (verified yes, no or partial, with a link to the report) instead of **Verify**

#### Scenario: No contradicted claim remains
- **WHEN** an answer contradicts a statement in a document under `docs/`
- **THEN** no document under `docs/` still makes that statement after the change

#### Scenario: Roadmap reflects the group
- **WHEN** the roadmap status table is read after the change
- **THEN** WG-02 shows as done, and each later work group whose scope an answer changed is updated
