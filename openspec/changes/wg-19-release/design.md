## Context

`scripts/replay` has one pass. It samples main prompts and worker briefs from session files (`corpus.ts`), rebuilds the request inputs (`inputs.ts`) and plans variant requests (`variants.ts`). It sends them through the package's own `askJev` (`run.ts`) and compares each variant with its base against two noise reruns (`compare.ts`). Its outputs are counts-only `aggregates.json` plus a private `cases.md` under `<agentDir>/jev/replay/<run-id>/` (`outputs.ts`). Its worker comparison routes with `routeLaunch` and the seed cut points only (`cutPointsFor([], mode)`), in the single mode read from `state.json`.

The #39 tier-mix evidence routed briefs per mode through a rolling window by an offline procedure that is not in the repository. The release report needs the same per-mode routing, but reproducible and in the tool.

The operator's config has four tiers and one slot, `reviewer`. There is no `state.json`, so the mode is `standard`. About 97 session directories are available.

## Goals / Non-Goals

**Goals:**
- A report pass whose numbers describe what 0.1 decides, on the operator's real sessions, with noise measured.
- README and scenario documentation that link every number to its evidence.
- Release metadata (version, changelog, pinned install) that a test keeps consistent.

**Non-Goals:**
- Measuring quality of routed models.
- Changing anything under `src/`.
- Automating the git-tag install. It needs the network and a pushed tag, so it stays a manual, recorded step.

## Decisions

**D1. A report pass, not new pass 1 variants.** `--pass report` plans two variants per kind, `report` and `rerun`, with the shipped inputs. Main requests use `SHIPPED_MAIN_GROUPS` rich state, and worker requests use the configured tiers and slots, which is how the host builds them. Pass 1 variants answer "does field X change decisions"; the report answers "what does the package decide". Mixing them would make `compare.ts` serve two meanings.
*Alternative:* reuse the pass 1 `minimal` base. Rejected because it is not what ships: the shipped state carries `last_decision` and `capabilities`.

**D2. One request per sample, routed in every mode offline.** The worker request does not depend on the mode (ADR 0008: one rubric for all modes). Each worker answer is therefore asked once per variant and routed three times, once per mode, with `routeLaunch`. The cut points come from a rolling window built with the package's own `windowEntries` and `cutPointsFor` rules: launches in sample order, latest 200, seed below 100. This matches the #39 method and adds no cost per mode.
*Alternative:* route with the seed cut points only, as pass 1 does. Rejected because live routing uses the window, and seed-only routing would misstate the mix.

**D3. Slot launches stay out of the window.** As in the host, a launch routed to a slot does not enter the cut-point window. The report also gives the mix with no slot configured (tiers only), so the reader sees both the "with reviewer slot" and "without slot" cases. Both mixes come from the same answers: the second routing drops the slot from the offered targets and needs no extra request.
*Alternative:* report only the configured case. Rejected because users without a reviewer slot are the default.

The first routing drops a slot in code only. The Jev request still offered the slot, so its probability is simply ignored. The no-slot figures are therefore an approximation, and the evidence file says so.

**D4. Main effort is compared with the start effort and with one fixed level.** For each main sample the report records:
- the effort the package would set (`decideEffort` with the shipped clamps; all levels supported, since the replay has no model registry);
- the effort recorded at prompt start (`startEffort`), when known.

From these it reports three things:
- the distribution of decided levels;
- lowered, same and raised counts against `startEffort`;
- the same counts against the single most common start level, which stands for "a user who never changes `/thinking`".

Samples without `startEffort` count only in the distribution.

**D5. Reviewer routing uses the corpus's own kind.** `workerKind` (review, scout, implementation) splits the worker samples. The report counts launches routed to `slot::reviewer` among review briefs and among the rest. A configured slot other than `reviewer` is counted under its own name.

**D6. Noise is the rerun difference, not a third rerun.** The report pass has one plain rerun of each request. For each figure the aggregate gives the run value and the rerun value. It also gives the share of samples whose decision changed between them: the effort level, and the tier in each mode. Pass 1's "two reruns" rule is pass-1 specific. One rerun is enough here because the report states values, not "beyond noise" verdicts. It also keeps the cost near the estimate the operator saw.

**D7. Separate output shape, same location and privacy.** Report aggregates are `{ v: 1, pass: "report", runId, samples, misses, main: {...}, workers: { byMode: {...}, reviewer: {...} } }`, counts only, written by the existing `writeOutputs` atomic path. `cases.md` for the report lists only the samples whose decision differed between the run and the rerun. It uses the same 300-code-point cut and stays private.

**D8. Release metadata is checked by a test.** A new `tests/release.test.ts` reads `package.json`, `CHANGELOG.md`, `README.md` and `docs/usage-guide.md`. It checks three things: the version has a `## [x.y.z]` changelog entry naming tag `vx.y.z`, every `pi install git:github.com/ttdua/pi-jev-pilot` line pins `@vx.y.z`, and no "design phase", "no code yet" or "Nothing is installable" banner remains. It is cheap, and it stops the next release from drifting.

**D9. Scenario 4 is documentation only.** The precedence tables in `docs/scenarios.md` are taken from `docs/domain-model.md` (WorkerDecision, MainDecision) and `docs/configuration.md` (value precedence). They link to those sections instead of restating every rule.

**D10. Manual tag acceptance.** After the operator approves pushing `v0.1.0`, they run `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0` into an empty `PI_CODING_AGENT_DIR` and check four things: install exits 0 with no load error; `/jev` shows the mode with no warning; one prompt writes a `main` ledger line; one `subagent` launch writes a `worker` line. Versions and pass or fail go into the evidence file, nothing else. The existing checkout install test (`tests/load.test.ts`) stays the automated check.

## Risks / Trade-offs

- [The operator's sessions were made with the earlier port, so `startEffort` mixes manual levels and the port's decisions] → The report states this next to the "vs start" figures, and also gives the fixed-level comparison (D4).
- [Briefs in the corpus were written for the port's agents, and some agents may not be in the capabilities snapshot] → Excluded samples are counted and reported (existing snapshot rule).
- [Offline window order is sample order, not launch time] → Stated in the evidence. The #39 method used extraction order too.
- [The no-slot mix ignores the slot's probability, not a request without the slot (D3)] → Stated as an approximation in the evidence.
- [Cost exceeds the estimate] → The dry run prints the exact request count and cost. Nothing is sent before the operator approves.
- [A one-operator sample] → Every figure carries the evidence's "read with care" note, and the README claims routing, not quality.

## Migration Plan

There is nothing to migrate. Users of the unpinned git install keep following `main`; the README asks new users to pin `@v0.1.0`. Rollback: revert the commit; the tag is pushed only with approval.

## Open Questions

None blocking. The sample sizes default to 100 main prompts and 200 worker briefs and may be lowered after the dry run if the operator asks.
