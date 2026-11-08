## Design Summary

WG-19 ([#20](https://github.com/ttdua/pi-jev-pilot/issues/20)) turns the finished package into the 0.1 release that others can install the way the operator already does: `pi install git:github.com/ttdua/pi-jev-pilot`. Every work group it depends on is closed.

**Why.** The operator already uses the package from git, but the documents still say "design phase, no code yet". A new user cannot tell what the package does for them, how to install a stable version, or what changes once it runs. The release must answer those three questions by describing behavior: for each feature, what changes in the user's sessions once it is on, when it acts, and how to turn it off.

**Revision (operator, 2026-11-08, after the first PR):** the README and `docs/scenarios.md` must not publish the operator's own usage numbers. Measured figures stay in `docs/evidence/` only, as counts, like the earlier evidence files. The user-facing docs describe behavior, not one operator's results.

**Goals**

- A rewritten `README.md`: what it is, install in a few commands pinned to `@v0.1.0`, how to check it works, and a feature-by-feature section. For each feature it says what changes in the user's sessions when it is on, when it acts, and how to turn it off. It also covers what never changes and what it costs (latency, data sent). No personal usage numbers.
- A new `docs/scenarios.md` with one section per scenario: when it applies, what the user does, and what the package decides. Behavior only, no measured numbers.
  1. **Effort follows the prompt.** The main-session effort distribution the package picks (low to max), compared with a fixed level, and the share of prompts it lowers or raises.
  2. **Worker model follows difficulty.** The tier mix (fast, balanced, deep, expert) for each mode (budget, standard, premium) on the same set of briefs.
  3. **Reviewer slot.** The share of review briefs routed to the `reviewer` slot, and the share of non-review briefs routed there by mistake.
  4. **Which rule wins.** The precedence of model and effort rules for workers, for the main session, and for config values. This one is documentation taken from `docs/domain-model.md` and `docs/configuration.md`; it needs no replay.
- A fresh replay with real Jev on the operator's session files to check scenarios 1 to 3 against what 0.1 ships, published as counts-only evidence in `docs/evidence/`. The evidence is not linked as a headline from the README or the scenarios. The method follows the existing [replay rules](../../../docs/testing.md#replay-rules): operator approval of the printed cost before sending, a plain rerun for noise, aggregates only in the repository.
- `CHANGELOG.md` with a `0.1.0` entry naming the `v0.1.0` tag.
- Release hygiene: `package.json` version `0.1.0`; the "design phase" and "planned behavior" banners removed from `README.md`, `docs/README.md` and `docs/usage-guide.md`; the install commands in the usage guide pinned to the tag; the roadmap's WG-19 marked done and its "Done when" reworded from a tarball to a git install.
- `typebox` declared as a `"*"` peer dependency, since `src/host/review.ts` imports it and Pi supplies it to extensions.

**Non-goals**

- No migration guide from the earlier port `naicoi92/pi-jev-pilot` (operator decision). The existing short note in the usage guide stays as it is.
- No npm publish, no tarball, no `files` whitelist: a git install clones the repository, so none of these reach users.
- Skill, advice and fail-open are covered in the README's feature section as behavior. They are not separate scenarios.
- No change to decision behavior, rubrics, thresholds or defaults.

**Anti-goals**

- Claiming that a routed model does the work better. The replay measures where the package routes work, never quality, and every number says so.
- Publishing one operator's usage figures (shares, counts, noise) in user-facing docs.
- Any prompt, brief, case text or account detail in the repository.
- Pushing the tag, pushing the branch or opening the PR without the operator's explicit go-ahead.

**Constraints**

- The replay costs money and is sent only after the operator approves the dry-run counts and cost (estimate about 600 requests, roughly $0.05).
- The existing replay tool `scripts/replay` only has pass 1, which compares state variants against a baseline. It cannot report the decision distribution per scenario, so the release needs a new report pass. This changes the `state-replay` capability.
- Public repository: everything committed is in English.

### Existing requirements involved

- `package-loading` / *Package manifest*: requires `@earendil-works/pi-coding-agent` as the only `"*"` peer and no runtime `dependencies`. **This change alters it**: `typebox` is added as a second `"*"` peer. There are still no runtime dependencies.
- `package-loading` / *Extension loads through a real install*: installs the checkout into an isolated agent dir. Unchanged. The automated check stays; the git-tag install is a manual release step (see Key Decisions).
- `state-replay` / *Dry run by default*, *Comparison against noise*, *Private and aggregate outputs*, *Replay uses the package builders*: the new report pass must keep all four. **This change adds** a report pass beside pass 1. It does not alter pass 1's variants or outputs.
- `state-replay` (CLI argument rules): pass 1 is currently the only accepted `--pass` value. **This change alters** that rule so a report pass is also accepted.

## Alternatives Considered

### Alternative A: Documentation only, numbers from existing evidence
- **Approach**: Rewrite the README and scenarios using the figures already in `docs/evidence/` (WG-12 replay, #39 tier mix, WG-16 state replay).
- **Pros**: No cost, no code change, smallest work group.
- **Cons**: The figures come from different code versions and question sets; no single run matches what 0.1 ships. There is no main-effort distribution against a fixed level, and no reviewer-slot misroute rate.
- **Why not chosen**: The operator asked for a new real run so the README describes the shipped package.

### Alternative B: Offline demo with Jev fixtures
- **Approach**: Script each scenario through the host test harness with fixture answers and show what the package does.
- **Pros**: Free, repeatable, could run in CI.
- **Cons**: Fixture answers are invented, so the numbers say nothing about real prompts.
- **Why not chosen**: It proves the flow, not the benefit; the operator chose real data.

### Alternative C: Report pass in `scripts/replay` with real Jev (chosen)
- **Approach**: Add a report pass that samples main prompts and worker briefs, rebuilds each request with the package's own builders at the shipped config, applies the package's own decision rules for every mode, sends with a plain rerun, and writes counts-only aggregates.
- **Pros**: Numbers match the shipped code; reuses the sampling, rebuilding, sending and output code of pass 1; same privacy and approval rules.
- **Cons**: Adds code and a spec change to a release work group; costs a few cents; one operator's data.
- **Why chosen**: See Agreed Approach.

## Agreed Approach

Alternative C, with documentation around it. The report pass gives evidence for scenarios 1 to 3 that matches what 0.1 ships. That evidence is kept in `docs/evidence/` for maintainers. Scenario 4 is written from the existing domain model. The README describes each feature's effect and links to `docs/scenarios.md` and the usage guide. The release is checked by a manual install of the pushed tag into an empty agent directory, run by the operator after they approve pushing the tag.

## Key Decisions

1. **Channel: git only, pinned to a tag.** Operator decision. The README and usage guide install with `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0`. `CHANGELOG.md` records the tag for each release.
2. **Acceptance: manual install of the pushed tag.** Operator decision: `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0` into an empty `PI_CODING_AGENT_DIR`, after the tag is pushed. The existing automated checkout install test stays in CI.
3. **Acceptance contents** (my call, since the question was skipped): a written checklist in the evidence file. The package installs from the tag with no errors. `/jev` shows the status with no warnings. One real prompt produces a main decision line in the ledger. One `subagent` launch produces a worker line. Results are recorded as counts and versions only.
4. **No migration guide.** Operator decision.
5. **Scenarios.** Operator selection: effort follows the prompt, worker model by difficulty per mode, reviewer slot, and rule precedence for model and effort.
6. **Real replay for the numbers.** Operator decision. The operator approves the cost after the dry run, before anything is sent.
7. **Benefits are framed as "what changes when you turn it on"** (operator decision, 2026-11-08): per feature, the effect on the user's sessions, when it acts and how to turn it off, with no personal numbers. This replaces the earlier "each claim sits next to its measured number".
8. **`typebox` becomes a peer dependency** (my call; Pi's package docs require host-provided imports to be declared as `"*"` peers).

## Open Questions

- The fixed level used as the comparison baseline in scenario 1. My default: the most common level recorded at prompt start in the sampled sessions, reported next to the result. The builder may refine it from the data.
- The sample sizes. My default: 100 main prompts and 200 worker briefs, stratified as pass 1 does, seed 1. The final size follows the dry-run cost the operator approves.
