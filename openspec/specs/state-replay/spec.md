# state-replay Specification

## Purpose
The offline replay tool `scripts/replay`. It samples local sessions and rebuilds each request with the package's own builders, one change per variant. It calls Jev only when asked, and compares decisions against two noise reruns. It writes counts-only aggregates plus a private case table outside the repository.

## Requirements

### Requirement: Replay uses the package builders
`scripts/replay` SHALL build every request with the package's own state builders, question builders, answer reader and decision functions, imported from `src/jev/`, `src/policy/` and `src/shared/`. It MUST NOT import `src/host/` or `src/store/`, and MUST NOT import Pi.

#### Scenario: Lint boundary
- **WHEN** lint runs over `scripts/`
- **THEN** no file there imports `src/host/`, `src/store/` or `@earendil-works/*`, and lint passes

#### Scenario: Same state as live
- **WHEN** the replay rebuilds the main state of a fixture session at a prompt
- **THEN** it equals the state the host builds from the same branch entries and platforms

### Requirement: Corpus sampling
The replay SHALL sample main prompts and worker briefs from session files under a given sessions directory, reproducibly from a seed.
- Main prompts: child sessions, prompts that start with `/` or `<skill`, and exact duplicates MUST be excluded. The sample MUST be stratified by project directory and by recorded starting effort.
- Worker briefs: taken from `subagent` tool calls, and stratified by agent kind.

#### Scenario: Same seed, same corpus
- **WHEN** the replay samples the same fixture sessions twice with seed 7
- **THEN** both corpora list the same prompts in the same order

#### Scenario: Exclusions
- **WHEN** the fixture sessions hold a prompt `/jev status` and the same prompt twice
- **THEN** the corpus has no `/jev status` and that prompt once

### Requirement: Replay inputs
The replay SHALL rebuild each rich input from local data by the rules in this change's `design.md` (D3). A sample whose input cannot be rebuilt MUST be excluded from the variants that need that input, and the number excluded MUST be reported per variant.

#### Scenario: Last decision from the earlier port
- **WHEN** the branch holds a `jev-pilot:effort` entry with `requested` `high` and strategy `direct`, before the sampled prompt
- **THEN** the rebuilt `last_decision` is `{ effort: "high", strategy: "direct" }`

### Requirement: Snapshot is required for capabilities and workers
The capabilities variants and the worker agent facts SHALL come only from the snapshot file given with `--capabilities`. Without the flag, the capabilities variants and every worker variant MUST be skipped, and the skips MUST be reported. A worker sample whose agent is not in the snapshot MUST be excluded and counted.

#### Scenario: No capabilities snapshot
- **WHEN** the replay runs without `--capabilities`
- **THEN** no capabilities variant and no worker variant is planned, and the report says both were skipped

#### Scenario: Worker agent missing from snapshot
- **WHEN** a worker sample's agent is absent from the snapshot
- **THEN** that sample is excluded from every worker variant and counted as excluded

### Requirement: One change per variant
In pass 1, each variant SHALL differ from its base in exactly one thing:
- one rich group added to minimal, or removed from full;
- the reversed order of the `effort` options;
- for workers: `parent_request` added, the agent `description` emptied, or `instructions_excerpt` emptied.

Every pass 1 run MUST include two plain reruns of each base. The report pass follows its own requirement, *Report pass plan*.

#### Scenario: Add-one variant
- **WHEN** the replay builds the `+last_decision` variant for a sample
- **THEN** its state equals the minimal state plus `conversation.last_decision`

#### Scenario: Reversed options
- **WHEN** the replay builds the `effort-reversed` variant
- **THEN** its `effort` options are the shipped option order reversed (`max`, `low`, `xhigh`, `medium`, `high` for the shipped `high`, `medium`, `xhigh`, `low`, `max`), and the state is minimal

#### Scenario: Reruns present
- **WHEN** a run plan is built for pass 1
- **THEN** it holds `rerun-a` and `rerun-b` for the main base and for the worker base

### Requirement: Dry run by default
Without `--send`, the replay SHALL make no network request. It MUST print the number of samples, variants and requests, and an estimated cost from the request sizes.

#### Scenario: Dry run
- **WHEN** the replay runs without `--send` against a loopback fixture
- **THEN** the fixture records no request, and the output names a request count and a cost in US dollars

#### Scenario: Send
- **WHEN** the replay runs with `--send` against a loopback fixture
- **THEN** the fixture records as many requests as the dry run counted

### Requirement: Jev failures are counted, not guessed
With `--send`, a request that times out, errors, or is rejected by the answer reader SHALL be retried once. A request that still fails MUST be recorded as a miss. A pair with a miss on either side MUST be excluded from the comparison, and the misses MUST be counted per variant.

#### Scenario: Miss excluded
- **WHEN** the fixture answers one variant request with HTTP 500 twice
- **THEN** that pair is absent from the flips, and the variant's miss count is 1

#### Scenario: Retry succeeds
- **WHEN** the fixture fails a request once and then answers
- **THEN** the answer is used and no miss is counted

### Requirement: Comparison against noise
In pass 1, for each variant and each decided key, the replay SHALL count the samples whose decision differs from the base. The keys are the effort level from `decideEffort`, the main tier, strategy, `risky > .7`, `corrects >= CORRECTION_THRESHOLD`, and the final worker tier and effort. The noise of a key MUST be the larger flip count of the two reruns. The aggregate MUST show the flips and the noise side by side, and MUST mark a variant as beyond noise only when its flips exceed the noise. The report pass reports values with one rerun instead (*Report pass noise and misses*).

#### Scenario: Within noise
- **WHEN** a variant flips 3 effort decisions and the reruns flip 2 and 4
- **THEN** the aggregate shows flips 3, noise 4, and does not mark it beyond noise

#### Scenario: Beyond noise
- **WHEN** a variant flips 12 strategy decisions and the reruns flip 1 and 2
- **THEN** it is marked beyond noise for strategy

### Requirement: Private and aggregate outputs
The replay SHALL write its outputs under `<agentDir>/jev/replay/<run-id>/`, owner-only, and nowhere else:
- `aggregates.json` MUST hold counts only.
- `cases.md` lists each differing pair, with the first 300 code points of the prompt or brief and both answers.

#### Scenario: Aggregates hold no text
- **WHEN** a fixture prompt contains `JEV-MARKER-PROMPT` and a run completes
- **THEN** `aggregates.json` does not contain `JEV-MARKER-PROMPT`, and `cases.md` does

#### Scenario: Nothing in the repository
- **WHEN** a run completes from the repository root, with `PI_CODING_AGENT_DIR` set to a directory outside the repository
- **THEN** `git status --porcelain` lists no new file

### Requirement: Report pass selection
The replay SHALL accept `--pass report` beside `--pass 1`. Any other value MUST be a usage error with exit code 2. `--only` MUST be a usage error with `--pass report`. The dry-run, send, miss and output-location requirements apply to the report pass unchanged.

#### Scenario: Report accepted
- **WHEN** the replay runs with `--pass report` and no `--send` against a loopback fixture
- **THEN** it exits 0, the fixture records no request, and the output names a request count and a cost in US dollars

#### Scenario: Unknown pass
- **WHEN** the replay runs with `--pass 2`
- **THEN** it exits 2 and names the accepted values `1` and `report`

#### Scenario: Only refused
- **WHEN** the replay runs with `--pass report --only full`
- **THEN** it exits 2

### Requirement: Report pass plan
The report pass SHALL plan exactly two variants per kind, `report` and `rerun`, with identical requests. Each worker sample MUST be asked once per variant, whatever the number of modes. A main sample missing a shipped group, and a worker sample whose agent is not in the snapshot, MUST be excluded and counted. Without `--capabilities`, the worker side MUST be skipped and reported.

#### Scenario: One worker request per variant
- **WHEN** the report plan is built for 10 worker samples with a snapshot
- **THEN** it holds exactly 10 `report` and 10 `rerun` worker requests

#### Scenario: No snapshot
- **WHEN** the report pass runs without `--capabilities`
- **THEN** no worker request is planned and the report says the workers were skipped

### Requirement: Report pass requests match the host
A report main request SHALL carry `mainState` with the `SHIPPED_MAIN_GROUPS` rich groups and `mainQuestions` with effort and strategy asked and no skills. A report worker request SHALL carry `buildWorkerState` with no `parent_request`, and `buildWorkerQuestions` with the configured tiers and slots.

#### Scenario: Shipped main state
- **WHEN** the report plan is built for a sample with a rebuilt `last_decision` and a snapshot
- **THEN** the `report` request's state equals `mainState` with both shipped groups, and the `rerun` request is identical

#### Scenario: Configured worker targets
- **WHEN** the config has four tiers and a `reviewer` slot
- **THEN** each worker request's tier question offers the four tiers and `slot::reviewer`

### Requirement: Report pass routing
For each worker answer, the report pass SHALL route the launch with `routeLaunch` in each mode `budget`, `standard` and `premium`, independently per variant, once with the configured slots and once with no slot offered. Main effort MUST be decided with `decideEffort` over all effort levels.

#### Scenario: Three modes, two routings
- **WHEN** one worker answer is routed
- **THEN** it yields six routed targets per variant: one per mode for each routing

#### Scenario: No-slot routing
- **WHEN** an answer gives `slot::reviewer` probability .9 and the no-slot routing runs
- **THEN** that launch routes by the cut to a tier, not to the slot

### Requirement: Report pass cut-point window
Cut points SHALL come from one window per mode, variant and routing, built from the earlier routed launches of that stream in sample order with the package's `windowEntries` and `cutPointsFor` rules. A launch routed to a slot MUST NOT enter the window.

#### Scenario: Seed then window
- **WHEN** 150 worker answers are routed in `standard`
- **THEN** the first 100 use `SEED_CUTPOINTS.standard`, and later launches use `cutPointsFor` over the routed launches before them

#### Scenario: Slot launch skips the window
- **WHEN** a launch routes to `slot::reviewer`
- **THEN** the window of the next launch has no entry for it

### Requirement: Report pass main aggregates
The report `aggregates.json` SHALL have `pass: "report"` and hold counts only. For main samples it MUST give, per variant, the count of each decided effort level. Among samples with a recorded start effort, it MUST also give the lowered, same and raised counts against that start effort, and against the most common start effort, which it names.

#### Scenario: Effort against start
- **WHEN** three main samples start at `high` and are decided `medium`, `high` and `xhigh`
- **THEN** the aggregate counts one lowered, one same and one raised against the start effort

#### Scenario: Aggregates hold no text
- **WHEN** a fixture prompt contains `JEV-MARKER-PROMPT` and a report run completes with one differing pair
- **THEN** `aggregates.json` does not contain `JEV-MARKER-PROMPT`, and `cases.md` does

### Requirement: Report pass worker aggregates
For workers, the report aggregates SHALL give, per variant, mode and routing, the count of each final tier and slot and of each route reason. For the routing with slots they MUST also give, per worker kind (review, scout, implementation), the count routed to each slot.

#### Scenario: Reviewer share by kind
- **WHEN** four review briefs and six implementation briefs are routed, and three review and one implementation brief go to `slot::reviewer`
- **THEN** the aggregate shows `reviewer` 3 for review and 1 for implementation

### Requirement: Report pass noise and misses
The report aggregates SHALL count the samples whose main effort, and whose worker target in each mode and routing, differ between `report` and `rerun`. A pair with a miss on either side MUST be excluded from these counts. Misses and exclusions MUST be counted per kind and variant. `cases.md` MUST list only the differing samples, with the first 300 code points of the prompt or brief.

#### Scenario: Miss excluded from noise
- **WHEN** a `rerun` worker request fails twice
- **THEN** that sample is absent from every noise count, and the worker `rerun` miss count is 1

#### Scenario: Jev unavailable
- **WHEN** the fixture answers every request with HTTP 500
- **THEN** the run completes, every request is a miss, the distributions are empty and no noise is counted
