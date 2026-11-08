## MODIFIED Requirements

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

### Requirement: Comparison against noise
In pass 1, for each variant and each decided key, the replay SHALL count the samples whose decision differs from the base. The keys are the effort level from `decideEffort`, the main tier, strategy, `risky > .7`, `corrects >= CORRECTION_THRESHOLD`, and the final worker tier and effort. The noise of a key MUST be the larger flip count of the two reruns. The aggregate MUST show the flips and the noise side by side, and MUST mark a variant as beyond noise only when its flips exceed the noise. The report pass reports values with one rerun instead (*Report pass noise and misses*).

#### Scenario: Within noise
- **WHEN** a variant flips 3 effort decisions and the reruns flip 2 and 4
- **THEN** the aggregate shows flips 3, noise 4, and does not mark it beyond noise

#### Scenario: Beyond noise
- **WHEN** a variant flips 12 strategy decisions and the reruns flip 1 and 2
- **THEN** it is marked beyond noise for strategy

## ADDED Requirements

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
