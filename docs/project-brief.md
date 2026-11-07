# Project brief

Date of this scope: 2026-11-05

| | |
|---|---|
| **Target host** | Official Pi, `@earendil-works/pi-coding-agent` 1.5.0 |
| **Subagent executor** | `@gotgenes/pi-subagents` 25.x |
| **Decision model** | TypeSafe Jev, `POST /v1/systemone`, `jev-latest` |

## Intent

A new Pi package that uses Jev, a fast typed classifier, to decide how Pi works on each prompt and each subagent: the main session's effort, each worker's model and effort, the one skill a prompt needs, and advice on how to split the work.

It is a clean rewrite. It takes selected behavior from [jev-pilot 0.12.1](https://github.com/Akramovic1/jev-pilot) (a Claude Code plugin, MIT) and does not continue the earlier port [`naicoi92/pi-jev-pilot`](https://github.com/naicoi92/pi-jev-pilot). The port stays useful as evidence of what Pi's seams allow, but its code is not the base.

**Why rewrite.** The port depends on a pinned fork of `pi-subagents` and on an undocumented user-message metadata seam verified only on Pi 1.4.0. The rewrite should be smaller, built on public Pi APIs, and easy to upgrade.

**Why the decisions look this way.** Measurement on real data changed the design more than once. The most important result: on 46 real worker briefs, the tier descriptions decide the routing, while truncating briefs, sending agent metadata and agent names barely change the answer. See the [evidence](evidence/2026-11-05-replay.md).

## Goals

- Spend less on easy work and more on hard work, without the operator choosing per task.
- Let the operator shift the whole distribution of models with one command: a mode.
- Fail open: when Jev is unavailable, Pi behaves as if the package were not installed.
- Record enough to judge the decisions later, without storing prompt text.
- Adjust itself without the operator having to remember a command.

## Non-goals

- Rewriting prompts, enforcing process, or acting as a permission system. Everything except model, effort and the optional tool removal is advice.
- Automatic main-model routing. The main model stays the one the operator selected.
- Mid-turn effort escalation. See [ADR 0007](decisions/0007-no-mid-turn-raise.md).
- `/jev report`, an animated pet, proactive worker health checks, upstream's `budget`, `junior-lead`, `second-opinion` and `quality` modes, suppressing Pi's skill listing, OpenRouter and Vercel backends, OpenRouter model lookup, and upstream's local proxy.
- Routing subagents started through `SubagentsService.spawn()` by other extensions, or launches that do not pass through the `subagent` tool.

## Anti-goals

The work has failed, even if it technically runs, when:

- A Jev outage slows or blocks work beyond the classifier timeout.
- A wrong classification breaks a turn or a worker launch, rather than merely routing it sub-optimally.
- A threshold silently blocks most decisions. Applying upstream's confidence bars to the operator's ledger would have blocked 118 of 221 effort changes.
- Prompt text, tool arguments or tool output land in the ledger.
- Tuning drifts on noise, or the operator cannot see or undo what it changed.

## Constraints

- Public Pi APIs only. No user-message metadata tricks, no patches, no package-cache edits.
- `@gotgenes/pi-subagents` is the executor. It runs children in-process, and a child binds the parent's extension set.
- Jev's primary language is English, and TypeSafe documents lower accuracy for other languages. The operator writes prompts in Vietnamese, so every threshold is uncalibrated until measured.
- Package code, docs, commits and comments are in English. This repository is public.
- Upstream is MIT. [NOTICE.md](../NOTICE.md) carries the attribution.

## Scope

The IDs are stable names for features, used in the [roadmap](roadmap.md).

### In scope

| ID | Feature | Roadmap |
|---|---|---|
| E1 | TypeSafe client (TypeSafe only) | WG-04 |
| E2 | Recent context and request signals in state | WG-07 |
| E4 | Fail-open | WG-04, WG-07 |
| A1 | Main session effort per prompt | WG-07 |
| A5 | Hold effort on providers that lose the cache | WG-08 |
| C1 | One skill per prompt | WG-09 |
| C2 | Inject the skill, or only suggest it | WG-09 |
| C5 | Platform detection from file names, needed by C1's question | WG-09 |
| D1 | Strategy advice | WG-10 |
| B1 | Worker model by tier | WG-11 |
| B2 | Worker effort from the brief | WG-11 |
| — | Modes: `budget`, `standard`, `premium` | WG-12 |
| H1 | `expert` tier | WG-12 |
| F1 | Custom model slots, checked against Pi's registry | WG-13 |
| H3 | Pre-launch fallback to a lower tier | WG-11 (tiers), WG-13 (slots) |
| H2 | Tool assessment in workers, through `@gotgenes/pi-subagents` | WG-14 |
| F4 | On-demand CLI review with Codex or OpenCode | WG-15 |
| G1 | Decision ledger | WG-05 |
| G3 | Automatic tuning | WG-18 |
| G4 | Session tally | WG-17 |
| G6 | Live switches and `/jev mode` | WG-06, WG-12 |
| G7 | Optional log, verbose mode | WG-17 |
| H4 | Status line above the editor | WG-06 |

`corrects` joins the main request on its own, because G1 has no other quality signal.

### Out of scope

| ID | Feature | Why |
|---|---|---|
| A2 | Confidence-based effort rules | [Blocks too much and predicts little](decisions/0002-probabilities-not-confidence.md). The risk floor and ceiling remain |
| A3 | Mid-turn raise | [The trigger almost never occurs](decisions/0007-no-mid-turn-raise.md) |
| A6 | Main-model routing | The main model is the operator's |
| B3 | Keeping a model the caller named | Not selected: **Jev overrides it unless the agent file locks it** |
| B4 | "Run a real check" line at low effort | Not selected |
| B5 | Model advice for workflows | Not selected |
| C3 | Suppressing Pi's skill listing | Not selected; would need verifying |
| C4 | Skill rerank request | One request is enough |
| C6 | `alwaysListed`, `neverSuggested` | Not selected |
| D2 | Quality advice blocks | Not selected, apart from `corrects` |
| D3 | Design pack | Not selected |
| D4 | Session note to the model | Not selected |
| E1 others | OpenRouter, Vercel, built-in backends | TypeSafe only |
| E3 | Follow-up detection | Not selected. "Continue" is classified with recent context |
| F2 | Upstream's `budget`, `junior-lead` modes | Replaced by the modes above |
| F3 | Upstream's `second-opinion`, `quality` modes | Not selected. Reviews run only on request |
| F5 | Worker health checks | Not selected. H3 covers pre-launch problems |
| G2 | `/jev report` | Not selected. The ledger stays readable |
| G5 | Animated pet | H4 replaces it |

## Approaches considered

1. **One package, public Pi APIs only (chosen).** Main-session context goes through `before_agent_start`'s `message`; workers through `tool_call` mutation and the child's `before_agent_start`. Much smaller than the port, and less exposed to host upgrades. Trade-off: injected skills and advice are real session history until compaction, so duplicates must be avoided, and they follow the history across forks.
2. **One package, per-request projection through `context`, as the port does.** Keeps history cleaner and gives exact per-branch control. Requires an originating-message identity Pi does not document as stable, the main source of the port's complexity.
3. **Separate core and adapter packages.** Makes the executor replaceable, at the cost of several versions to keep in sync for one user and one executor. Internal module boundaries give most of the benefit.

## Left to the builder

- Exact file layout within the [module boundaries](architecture.md#module-layout).
- Language and tooling details: TypeScript run by Pi directly, Bun for tests, matching the Pi ecosystem.
- Ledger concurrency and trimming, provided lines are never silently lost to a parallel Pi process.
- Exact wording of the tool assessment criteria, verified by replay.
- How agent files are parsed, and the table of the executor's built-in agents, since no public registry API exposes them.
- ~~How `workspace.languages` is detected~~. Removed: the [WG-16 replay](evidence/2026-11-07-state-replay.md) found it within noise.
