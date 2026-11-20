## Why

Tier and effort currently measure the same thing (how hard or long the work is): both rubrics list "unknown bug cause" and "novel architecture", the score adds them, `expert` needs high effort, `fast` caps effort, and the strategy gate reads tier as work size. The model ladder (haiku < sonnet < opus < fable) differs in trained knowledge, while effort controls how hard the agent works. Splitting the axes lets Jev answer each question about one thing, so model and effort are picked more accurately.

## What Changes

**Tier names and meaning**
- From: `fast`, `balanced`, `deep`, `expert`, described by task difficulty and length.
- To: `basic`, `broad`, `deep`, `frontier`, described by the knowledge the task needs. Rubric version 2 → 3.
- Impact: public config keys, the `expert` switch and `/jev expert` change name. At the first main session start, `config.json` and `state.json` are rewritten to the new names; old names also stay readable as deprecated aliases for one minor version. Old ledger lines stay valid.

**Effort rubric**
- From: work difficulty, overlapping the tier rubric.
- To: amount of work and care (steps, tracing, tool calls, verification); knowledge is excluded. Same five levels and option order.

**Difficulty score**
- From: `Σ rank·P̂ + rank(effort)/8`.
- To: `Σ rank·P̂` only.

**Frontier rule**
- From: score ≥ `expertMin` and effort `xhigh`/`max`; cut counts only high-effort entries.
- To: score ≥ `frontierMin`, the cut counting every window entry; no effort condition.

**Frontier cap**
- From: `standard` 2%, `premium` 5%.
- To: `standard` 1%, `premium` 3% (`deep` share absorbs the difference). `budget` unchanged at 0.

**Risk floor**
- From: `risky > .7` lifts the tier to `deep` and effort to at least `high`.
- To: lifts effort only. The decision order becomes `frontier`, `slot`, `cut`.

**Worker effort on `basic`**
- From: capped at `medium` on `fast`.
- To: no cap by tier.

**Strategy gate**
- From: main request asks `tier`; `parallel` needs tier ≠ `fast`, `graph` needs tier `deep`.
- To: main request no longer asks `tier`; it asks `effort` whenever `strategy` is on (also when held or `effort` is off, then only for the gate). `delegate` and `parallel` need effort ≥ `medium`, `graph` needs effort ≥ `xhigh`.

**Seed cut points**
- Re-derived from an operator replay of the worker corpus with the new rubric and published in a new evidence note.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `worker-decision`: decision order without the risk rule, frontier rule without effort, worker effort without the tier cap, tier names throughout.
- `mode-cutpoints`: tier-only score, `frontierMin` over all entries, window eligibility on `frontierOffered`, new seed, mix keys.
- `worker-modes`: target table with new names and caps 1% / 3%.
- `worker-request`: offered tier names, knowledge rubric and effort wording, rubric version 3, `frontier` switch.
- `worker-routing`: scenarios and warning settings use the new tier names.
- `strategy-advice`: no main `tier` question; gates read `effort`.
- `main-effort`: main question set (`effort` asked whenever `strategy` is on; no `tier`), effort-eligible vs gate-only effort, effort wording around work and care.
- `state-replay`: the main tier comparison key is removed.
- `slot-commands`: `frontier` is a feature, and a legacy `frontier` slot blocks slot writes until renamed.
- `effort-hold`: a held prompt with `strategy` on asks `effort` for the gate only.
- `main-ledger`: a gate-only `effort` answer is not recorded.
- `config-file`: `tiers.basic|broad|deep|frontier`, deprecated aliases for old keys, start-up migration of `config.json` and `state.json`, `frontier` reserved as a slot name with an existing `frontier` slot still read.
- `state-file`: `frontier` switch, legacy `expert` switch accepted and moved.
- `decision-ledger`: target domain, `frontierOffered`, reason `frontier`; old values accepted on read.
- `worker-ledger`: decision fields use `frontierOffered` and new tier names.
- `jev-command`: `frontier` feature, mix line names, deprecated `/jev expert` alias.
- `status-line`: decision features list names `frontier`.
- `tuning-signals`: low worker routing reads `basic` (and legacy `fast`).
- `verbose-log`: `tierP` key order uses new names.
- `release-metadata`: README names the `frontier` tier and switch.

`session-tally` is not modified: it never reads tier names; its scenarios use ledger data that stays valid.

Scenario headings of modified requirements keep their baseline names where OpenSpec requires it; each one whose meaning changed carries an `Intentional change` comment.

## Impact

- **Code**: `src/policy/launch.ts`, `src/policy/effort.ts`, `src/policy/worker/{score,tier,cutpoints,cut-window,modes,seed,ledger-line,route}.ts`, `src/policy/main/{strategy,outcome}.ts`, `src/policy/tuning/signals.ts`, `src/jev/{rubrics,questions}.ts`, `src/host/main/gate.ts`, `src/host/worker/request.ts`, `src/host/status/line.ts`, `src/host/commands/{args,apply,jev,status-format}.ts`, `src/store/{defaults,config,state-file,ledger-schema,settings-sections}.ts`, `scripts/replay/{config,report-route,report}.ts`.
- **Public config/CLI**: `tiers.*` keys, `switches.expert`, `/jev expert` (aliased for one minor).
- **Docs updated**: `docs/jev-questions.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/jev-contract.md`, `docs/testing.md`, `docs/scenarios.md`, `README.md`, `CHANGELOG.md`; new `docs/decisions/0010-knowledge-tiers.md` (supersedes the tier parts of ADR 0008) and a new `docs/evidence/<date>-knowledge-tier-mix.md`.
- **Operator step**: one paid replay (approval needed) to derive the seed.
