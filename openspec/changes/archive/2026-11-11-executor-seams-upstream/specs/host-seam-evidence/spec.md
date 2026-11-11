## ADDED Requirements

### Requirement: Launch policy host evidence
Host tests SHALL show, through real Pi sessions against the recording fixture, that:
- a launch policy's model and thinking reach the child's first provider request, for foreground, background and service launches, and for a launch with `inherit_context: true` (with the parent marker still present);
- a locked agent field wins over the policy;
- a policy that exceeds its timeout lets the launch run with the requested values;
- a granted extension tool is offered and callable in the child;
- a `disallowed_tools` entry is absent even when granted;
- the effective model on the worker's ledger line equals the child's first request `model`.

#### Scenario: Policy model reaches the child
- **WHEN** a probe policy sets `fixture/fixture-fast` and `medium` for a foreground launch
- **THEN** the child's first request has that `model` and `reasoning_effort` `medium`

#### Scenario: Inherited context with a policy model
- **WHEN** a probe policy sets a model for a launch with `inherit_context: true`, and the parent conversation contains a synthetic marker
- **THEN** the child's first request uses the policy's model and contains the marker

#### Scenario: Grant reaches the child
- **WHEN** a probe policy grants a probe extension's tool to an agent without `tools`
- **THEN** the child's first request lists that tool and the fixture-scripted call to it executes

## MODIFIED Requirements

### Requirement: Answers are pinned by host tests
Each host test for WG-02 questions 3 to 6 SHALL assert, as fixed expected values in the test, the values stated for that question in the evidence report, so that a change in Pi or executor behavior makes the test fail. A negative answer MUST be pinned the same way as a positive one. A question the report marks unsettled or superseded is exempt.

#### Scenario: Changed host behavior fails the test
- **WHEN** a host test's observed value differs from the value stated in the evidence report
- **THEN** the test fails and names the question it covers

### Requirement: Evidence report
The repository SHALL contain an evidence report in `docs/evidence/` giving, per WG-02 question, the answer, its supporting test or run, its testing level as named in `docs/testing.md`, and the tested versions. An answer MUST come from a run; a negative answer is an answer; a question no run settled MUST be marked unsettled with the reason. A question whose seam the package no longer uses SHALL be marked superseded, keep its recorded answer, and link the requirement and host test that replace it. The report MUST NOT contain real prompts, session content, request bodies, secrets or account details.

#### Scenario: Every question answered or marked unsettled
- **WHEN** the report is read
- **THEN** each of the eight questions has an answer citing a test or run and a testing level, or is marked unsettled with a reason

#### Scenario: Superseded questions kept
- **WHEN** the report is read after the launch policy replaced the `tool_call` and `message_end` seams
- **THEN** Q1, Q2 and Q7 are marked superseded, keep their answers, and link `executor-launch-policy` and its host tests

## REMOVED Requirements

### Requirement: Worker model and thinking mutation
**Reason**: The package no longer rewrites `subagent` input in `tool_call`; the launch policy replaces it.
**Migration**: "Launch policy host evidence". The evidence report keeps Q1's answer, marked superseded.

### Requirement: Message end ordering
**Reason**: The package no longer classifies launches at `message_end`.
**Migration**: None. The evidence report keeps Q2's answer, marked superseded.

### Requirement: Model mutation with inherited context
**Reason**: Model changes go through the launch policy.
**Migration**: "Launch policy host evidence", inherited-context scenario. The evidence report keeps Q7's answer, marked superseded.
