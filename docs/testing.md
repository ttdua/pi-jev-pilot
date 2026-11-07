# Testing strategy

Each level proves something different. A claim must name the level that supports it. In particular, unit tests are never described as end-to-end.

| Level | Runs | Proves | Cannot prove |
|---|---|---|---|
| **Unit** | Pure policy, stores, state builders, no network | The rules do what they say | That Pi calls them, or that Jev answers that way |
| **Contract** | Jev client against a local HTTP fixture (`tests/jev/fixture.ts`) | Transport and parsing, including failures | Real Jev behavior |
| **Host** | The real Pi CLI in RPC mode, local Jev and provider fixtures, real executor children, isolated `PI_CODING_AGENT_DIR` | The whole path through Pi, at a tested version | Real model quality, or other Pi versions |
| **Replay** | Real prompts through real Jev, offline from Pi | How Jev routes real work | Whether the routed model does well |
| **Field** | Real use, read from the ledger | What actually happens, and outcomes | Causes, without an experiment |

Unit, contract and host tests run in CI: no secrets, no paid calls, no network beyond loopback. Replay and field work are manual and need approval.

## What must be tested

### Unit

- Answer reading: valid, missing, unknown choice, out-of-range numbers, mixed good and bad.
- Effort rules: table over choice, `risky`, current level and supported levels.
- Worker decision order: table per mode, including every boundary: .6 slot, .7 risky, a score at a cut going to the lower tier, and the expert cut with effort `xhigh` or `max`.
- Skill pick: all paths, including batches and `(none)`.
- Strategy gates: each boundary.
- Tuning: fire, cooldown, range, revert, allowlist.
- Ledger: schema rejects free text, tolerates bad lines.

Expected values come from this documentation, not from running the code. Each [invariant](domain-model.md#invariants) has at least one test named after it.

### Host

The manual Q8 run and the manual CLI review run are the only Host evidence that uses real providers and logins. They are run by hand and are never part of CI.

- A decision applies on the first provider request of the turn, by reading what the fixture received.
- Jev down: identical provider requests to a run without the package, apart from a status line and the `jev_review` tool declaration with its prompt lines (the only other difference).
- Esc during classification: no provider request follows.
- A worker's actual model and thinking at the child's first request, foreground and background.
- Nothing from a hidden log line reaches a provider.
- Installation from a packed tarball, not only a checkout.
- CLI review with fake `codex` and `opencode` scripts on `PATH`: the exact command lines, success, failure and exit codes, one retry on timeout, tier resolution at each run, the output file removed, and no brief or output in details or the ledger.
- The review tool is offered in the main session and absent in a child's provider request.

The harness lives in `tests/host/`: the real CLI in RPC mode, an isolated agent directory, a loopback recording provider and probe extensions. Findings are in the [host seams report](evidence/2026-11-05-host-seams.md).

**Manual Q8 procedure** (not in CI): `bun tests/host/manual/q8-claude-code.ts`. Needs a `claude` login; prints counts only, never prompts or bodies.

**Manual CLI review procedure** (not in CI): `bun tests/host/manual/cli-review-real.ts`. Needs `codex` and `opencode` logins (each is skipped when not installed). It reviews a throwaway repository and prints counts only: outcome, attempts, exit code and output length, never the text. Set `JEV_REVIEW_CODEX_MODEL` or `JEV_REVIEW_OPENCODE_MODEL` to pick a model. Run it by hand after each CLI upgrade. Last run: [CLI review evidence](evidence/2026-11-06-cli-review.md).

### Privacy

A test asserts the exact field set of each ledger kind against `LEDGER_FIELDS`, so adding a field that leaves the machine fails until the test and [Privacy](privacy.md) change together. Another searches the ledger after a host run for a marker placed in the prompt, and must not find it.

## Version policy

Host tests pin Pi and `@gotgenes/pi-subagents`. Upgrading either reruns them, and the [host seams](architecture.md#host-seams) table is rechecked. The peer ranges state only what has been tested.

## Replay rules

- Needs the operator's approval each time, stating the data and the estimated cost.
- Input stays outside the repository. Output committed here is aggregate only.
- Always includes a plain rerun, to measure noise. A difference smaller than noise is not a result.
- Changes one thing per variant.
- Reports where Jev routes, and never claims that a route is better without separate evidence.

### Rich state replay

A manual procedure (not in CI) that sends real prompts to real Jev with and without the extra state fields, to decide which fields to ship. Run it only after the operator approves the data and the cost.

1. Save the capabilities snapshot: `bun tests/host/manual/capabilities-snapshot.ts <scratch>/capabilities.json`. It starts Pi against your real agent directory, needs no model call, and prints counts only. The file is written owner-only.
2. Do a dry run (no request is sent): `bun scripts/replay/cli.ts --pass 1 --capabilities <scratch>/capabilities.json`. It prints sample counts, variants, exclusions, the request count and the estimated cost. Retries are not in the estimate.
3. Get the operator's approval of the printed counts and cost.
4. Run it: the same command plus `--send`. The key is read from the environment variable named by `classifier.apiKeyEnv` (default `TYPESAFE_API_KEY`).

Options: `--pass 1|report` (pass 2 was removed), `--seed N` (1), `--main N` (100), `--workers N` (46 for pass 1, 200 for report), `--sessions DIR` (`<agentDir>/sessions`), `--url URL` (must be https or loopback http), `--only a,b` (run only the bases, the reruns and the listed variants, for example `--only effort-reversed`). `--models FILE` is still accepted but does nothing: the context percentage it served was removed.

Outputs go under `<agentDir>/jev/replay/<run-id>/`: `aggregates.json` (counts only) and `cases.md` (the differing prompts and briefs). They are private and owner-only. Copy only aggregates into evidence, and delete the directory after the decision.

### Release report

A manual procedure (not in CI) that measures where the shipped Jev questions send real prompts and briefs, for the release notes. It sends every sampled prompt twice (`report` and a plain `rerun`) so that the difference between the two is the noise floor. Run it only after the operator approves the data and the cost.

1. Save the capabilities snapshot: `bun tests/host/manual/capabilities-snapshot.ts <scratch>/capabilities.json`. Without a snapshot the worker part is skipped and only main prompts are replayed.
2. Do a dry run (no request is sent): `bun scripts/replay/cli.ts --pass report --capabilities <scratch>/capabilities.json`. It prints sample counts, exclusions, the request count and the estimated cost. Retries are not in the estimate.
3. Get the operator's approval, then run the same command plus `--send`.

Samples default to 100 main prompts and 200 worker briefs (`--main N`, `--workers N`; pass 1 keeps 46 workers). `--only` is not accepted with `--pass report`.

Outputs go under `<agentDir>/jev/replay/<run-id>-report/`. `aggregates.json` holds counts only: effort per run against the start effort and against the fixed level, worker targets and reasons for each mode (`budget`, `standard`, `premium`) under both routings, the number of misses, and the noise (samples whose decision differs between the run and its rerun). `cases.md` holds the differing prompts and briefs, so it stays private and owner-only: never copy it, and delete the directory after the decision.

Read it with care. It shows routing, not quality: it says where Jev sent a sample, not that the target was better. A difference smaller than the noise is not a result.

The `tiers` routing is an approximation (design D3). It shows the mix with no slot configured, built from the same answers: the slot is dropped from the offered targets and its probability is ignored, rather than asking Jev again without the slot. The `slots` routing applies the configured slots and is the closer picture of a real launch.

## Not in CI, deliberately

Live Jev calls, paid models, and CLI reviews with real logins. They would add cost and flakiness, and would need secrets.
