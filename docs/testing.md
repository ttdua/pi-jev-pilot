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
- Worker decision order: table per mode, including every boundary (.6, .7, .9, .1).
- Skill pick: all paths, including batches and `(none)`.
- Strategy gates: each boundary.
- Tuning: fire, cooldown, range, revert, allowlist.
- Ledger: schema rejects free text, tolerates bad lines.

Expected values come from this documentation, not from running the code. Each [invariant](domain-model.md#invariants) has at least one test named after it.

### Host

The manual Q8 run is the only Host evidence that uses a real provider and login. It is run by hand and is never part of CI.

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

**Manual CLI review procedure** (not in CI): `bun tests/host/manual/cli-review-real.ts`. Needs `codex` and `opencode` logins (each is skipped when not installed). It reviews a throwaway repository and prints counts only: outcome, attempts, exit code and output length, never the text. Set `JEV_REVIEW_CODEX_MODEL` or `JEV_REVIEW_OPENCODE_MODEL` to pick a model. Run it by hand after each CLI upgrade.

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

## Not in CI, deliberately

Live Jev calls, paid models, and CLI reviews with real logins. They would add cost and flakiness, and would need secrets.
