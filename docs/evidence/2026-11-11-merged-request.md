# Evidence: one merged Jev request per launch, 2026-11-11

This is the gate replay for [#58](https://github.com/ttdua/pi-jev-pilot/issues/58). It asks whether a worker launch could send one Jev request (worker questions plus tool questions on one state) instead of two (the worker request and the tool assessment request), without moving the tier mix of [ADR 0008](../decisions/0008-mode-target-cutpoints.md). The figures are aggregates from one operator's data. Briefs, answers and scripts are not in this repository.

**Outcome:** the merged request passes the tier-mix gate, but it saves about 6% of the bytes, and so about 6% of the cost, and no latency. The operator kept the two requests and closed #58.

## Data

| Item | Value |
|---|---|
| Source | The 400 most recent unique (agent, brief) worker launches, from the sessions that have rubric-2 worker lines in the ledger (2026-11-07 to 2026-11-11) |
| Briefs | 400: 254 reviews and 146 non-review launches. 195 `code-reviewer`, 154 `general-purpose`, 36 `Plan`, 10 `Explore`, 5 others |
| Agents | Agent facts from the operator's agent files, through the executor's own registry and `agentFacts` |
| Tools | The operator's live Pi tools with descriptions, sources and parameter descriptions (`toolFacts`), and candidates from `toolPlan` over the executor's default tools. Median 24 candidates per launch, at most 29 |
| Config | All four tiers with registry display names, no slot, the shipped seed and targets |
| Model | `jev-latest` |
| Requests | 2400: three variants, each asked twice (a run and a plain rerun). No misses, no unanswered question |

## Variants

- **Worker (W):** the shipped worker request (`buildWorkerState`, `buildWorkerQuestions`).
- **Tool (T):** the shipped tool assessment request (`buildToolState`, `buildToolQuestions`).
- **Merged (M):** the worker state plus the tool state's `tools` key, with the worker questions plus the tool questions. Its `task` is the worker's (the first 4000 code points of the brief).

**Split** is W and T together, as the package sends them today.

## Tier mix by mode

Routing is offline, per mode, in launch order, with `cutPointsFor` over the window of earlier launches (`routeStreamRecords`), as in the [tier-mix replay](2026-11-07-tier-mix.md). Shares are percents of launches. A share is in range within ±10 points of its target; `expert` is in range up to the cap plus 10 points.

### All launches (n = 400): the gate

| Mode | Variant | Run | `fast` | `balanced` | `deep` | `expert` | In range |
|---|---|---|---|---|---|---|---|
| `budget` | split | run | 45.3 | 43.0 | 11.8 | 0.0 | Yes |
| `budget` | split | rerun | 45.3 | 43.5 | 11.3 | 0.0 | Yes |
| `budget` | merged | run | 47.5 | 40.5 | 12.0 | 0.0 | Yes |
| `budget` | merged | rerun | 47.3 | 40.5 | 12.3 | 0.0 | Yes |
| `standard` | split | run | 18.3 | 52.3 | 28.5 | 1.0 | Yes |
| `standard` | split | rerun | 17.8 | 53.3 | 27.8 | 1.3 | Yes |
| `standard` | merged | run | 17.3 | 54.0 | 27.8 | 1.0 | Yes |
| `standard` | merged | rerun | 17.8 | 54.0 | 27.0 | 1.3 | Yes |
| `premium` | split | run | 0.0 | 45.3 | 53.3 | 1.5 | Yes |
| `premium` | split | rerun | 0.0 | 45.3 | 53.0 | 1.8 | Yes |
| `premium` | merged | run | 0.0 | 47.5 | 50.5 | 2.0 | Yes |
| `premium` | merged | rerun | 0.0 | 47.3 | 50.5 | 2.3 | Yes |

### Non-review launches (n = 146)

Out of range for **both** variants in every mode, in the mixed stream and in a stream of non-review launches only (no slot). The split and merged shares differ by at most 6 points. This matches the known limitation of the tier-mix replay and is not caused by merging.

## Answer shift

| Measure | Merged vs split | Split rerun noise | Merged rerun noise |
|---|---|---|---|
| Difficulty score, mean of merged − split | −0.044 (run), −0.048 (rerun) | +0.004 | 0.000 |
| Difficulty score, mean absolute change | 0.067 | 0.026 | 0.022 |
| `tier` choice flips | 25 / 23 of 400 | 10 | 4 |
| `effort` choice flips | 32 / 29 of 400 | 17 | 8 |
| `risky > .7` flips | 0 | 0 | 0 |
| `tool::` flags (≥ .5) flips | 0 of 1078 | 0 | 0 |
| `grant::` grants (≥ .8) flips | 15 of 8307 | 5 | 2 |

The merged request lowers the difficulty score slightly but consistently: the shift is small against the gaps between cut points, which is why the mix stays in range. It also grants less: 2 grants against 17 for the split tool request.

## Cost and latency

| Request | Bytes per launch | Estimated USD per launch |
|---|---|---|
| Worker | 6.5 KB | $0.00007 |
| Tool | 30.2 KB | $0.00032 |
| Split (both) | 36.7 KB | $0.00039 |
| Merged | 34.4 KB | $0.00036 |

Cost is estimated from $0.042 per million input tokens at about 4 bytes per token. Jev bills input tokens only, with no per-request charge, so two requests cost the same as one request with the same content. Merging removes only the repeated `task` and `agent`, about 6%.

The tool request is 82% of the split bytes. Its grant questions and the tool entries they carry are about 74% of the split bytes, its block questions about 9%. Parameter descriptions in `tools` are about 35%.

| Latency | Median | p90 | Max |
|---|---|---|---|
| Worker | 220 ms | 244 ms | 621 ms |
| Tool | 257 ms | 286 ms | 1029 ms |
| Split launch wait (slower of the two) | 258 ms | 289 ms | 1029 ms |
| Merged | 264 ms | 293 ms | 1139 ms |

## Tool decisions

From the split tool request in this replay:

- **Block (`tool::`):** only `general-purpose` launches have block candidates, since the other agents declare `tools`. 1 of 154 was flagged (`edit` .80, `write` .64), a planning-only brief. The other `general-purpose` launches were implementation or fix work, and nothing was flagged.
- **Grant (`grant::`):** 17 grants at `grantAt` .8: 12 for `powershell`, a tool not active on this macOS machine, and 5 for `write` to agents whose authors made them read-only (`code-reviewer`, `Plan`, `Explore`). None was useful.

The operator's ledger agrees on blocks: in `observe` mode, 43 of 211 assessed launches since 2026-11-07 had a tool flagged, almost all on 2026-11-07 and 2026-11-08. It has no grant data, since the installed build predates grants.

## Reading

- The gate is met: over all launches, the merged request keeps every mode in range in the run and the rerun.
- The gain is not what #58 expected. The bytes saved are about 6%, not 40–50%, because tool descriptions and tool questions dominate the request, not the shared `task` and `agent`. Latency does not improve, since the split requests already run concurrently.
- Merging has costs: a small systematic score shift, fewer grants, one failure losing both decisions, and a change to the `tool-assessment` spec.
- The cost of a launch lies in the grant questions, whose answers were not useful in this replay. That is the lever for cost, not the request count.

Operator decision (2026-11-11): keep the two requests and close #58 with this evidence.

## Cost of these measurements

2400 replay requests, about $0.60 estimated from size and list price, not from an invoice.
