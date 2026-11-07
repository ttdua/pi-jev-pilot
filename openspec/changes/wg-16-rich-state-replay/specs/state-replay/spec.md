## ADDED Requirements

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

#### Scenario: Missing cwd
- **WHEN** two sampled sessions have a `cwd` that no longer exists
- **THEN** the languages variants exclude them, and the report says 2 excluded

#### Scenario: Unmatched git count
- **WHEN** a pass 2 sample has no recorder line with its `turnId`
- **THEN** it is excluded from the git variants and counted as excluded

### Requirement: Snapshot is required for capabilities and workers
The capabilities variants and the worker agent facts SHALL come only from the snapshot file given with `--capabilities`. Without the flag, the capabilities variants and every worker variant MUST be skipped, and the skips MUST be reported. A worker sample whose agent is not in the snapshot MUST be excluded and counted.

#### Scenario: No capabilities snapshot
- **WHEN** the replay runs without `--capabilities`
- **THEN** no capabilities variant and no worker variant is planned, and the report says both were skipped

#### Scenario: Worker agent missing from snapshot
- **WHEN** a worker sample's agent is absent from the snapshot
- **THEN** that sample is excluded from every worker variant and counted as excluded

### Requirement: One change per variant
Each variant SHALL differ from its base in exactly one thing:
- one rich group added to minimal, or removed from full;
- the reversed order of the `effort` options;
- for workers: `parent_request` added, the agent `description` emptied, or `instructions_excerpt` emptied.

Every run MUST include two plain reruns of each base.

#### Scenario: Add-one variant
- **WHEN** the replay builds the `+languages` variant for a sample
- **THEN** its state equals the minimal state plus `workspace.languages`

#### Scenario: Reversed options
- **WHEN** the replay builds the `effort-reversed` variant
- **THEN** its `effort` options are `max`, `xhigh`, `high`, `medium`, `low`, and the state is minimal

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
For each variant and each decided key, the replay SHALL count the samples whose decision differs from the base. The keys are the effort level from `decideEffort`, the main tier, strategy, `risky > .7`, `corrects >= CORRECTION_THRESHOLD`, and the final worker tier and effort. The noise of a key MUST be the larger flip count of the two reruns. The aggregate MUST show the flips and the noise side by side, and MUST mark a variant as beyond noise only when its flips exceed the noise.

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
