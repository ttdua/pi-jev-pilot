## Why

Every work group before WG-19 is done and the operator already runs the package from git, but the documents still say "design phase, no code yet". A new user cannot see what the package does for them, how to install a stable version, or which rule wins when several apply. The 0.1 release should describe, feature by feature, what changes in a user's sessions when it is on. The behavior is checked against a replay of real sessions, and the measured counts stay in maintainer evidence, never in user-facing docs.

## What Changes

**Install channel**
- From: the usage guide installs `git:github.com/ttdua/pi-jev-pilot` unpinned, and the roadmap's WG-19 "Done when" talks about a packed tarball.
- To: install with `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0`. `CHANGELOG.md` names the tag of each release, and `package.json` carries version `0.1.0`. The roadmap is reworded to a git-tag install checked by hand.
- Reason: Pi installs git sources by cloning, so a tarball never reaches users.
- Impact: non-breaking. An unpinned install keeps following `main`.

**Package manifest**
- From: `@earendil-works/pi-coding-agent` is the only `"*"` peer, although `src/host/review.ts` imports `typebox`.
- To: `typebox` is declared as a `"*"` peer too. There are still no runtime `dependencies`.
- Reason: Pi supplies `typebox` to extensions, and its package guide asks for host-provided imports to be declared as `"*"` peers.
- Impact: non-breaking.

**Replay report pass**
- From: `scripts/replay` only runs pass 1, which compares state variants with a baseline.
- To: a `--pass report` that rebuilds requests exactly as the shipped package sends them and counts what the package decides: the main effort distribution compared with the effort at prompt start, the worker tier mix in each mode on the same briefs, and reviewer-slot routing of review and non-review briefs. A plain rerun measures the noise. It keeps the dry run by default, the miss rules and the counts-only outputs.
- Reason: to check that the documented scenarios match what 0.1 decides. The counts go to `docs/evidence/` only.
- Impact: non-breaking. Pass 1 is unchanged.

**Documentation**
- A `README.md` rewritten feature by feature. It says what the package is, how to install it, and how to check it works. For each feature it gives the effect on your sessions when on, when it acts and how to turn it off. It also says what never changes and the costs (latency, data sent). No personal usage numbers.
- A new `docs/scenarios.md` with one section per scenario: effort follows the prompt, worker model follows difficulty, the reviewer slot, and which rule wins for model, effort and config values. Behavior only, no measured numbers.
- A new evidence file in `docs/evidence/` with the report-pass aggregates (counts only) and the manual install check of the tag. It is maintainer evidence, not linked as a headline from the README or the scenarios.
- The "design phase" and "planned behavior" banners removed.
- Two features merged to `main` during apply are folded into the release docs within the existing four scenarios: the CLI review on/off setting (#48), off by default, and the per-directory mode (#49), set with `/jev mode <m>`, while `/jev mode <m> global` sets the global mode. This is the operator's request of 2026-11-08.

**Not in scope:** a migration guide from the earlier port (by operator decision), an npm publish, a tarball, and any change to decision behavior.

## Capabilities

### New Capabilities
- `release-metadata`: the release version, its changelog entry and the pinned install command stay consistent across `package.json`, `CHANGELOG.md`, `README.md` and the usage guide. The user-facing docs carry no measured usage figures.

### Modified Capabilities
- `package-loading`: *Package manifest* adds `typebox` as a second allowed `"*"` peer dependency.
- `state-replay`: a report pass is added beside pass 1, with its own plan, per-mode worker routing, distribution aggregates and noise rerun. The existing requirements still hold for pass 1.

## Impact

- **Code:** `scripts/replay/` (`config.ts`, `cli.ts`, `variants.ts`, a new `report.ts`) with tests in `tests/replay/`. No change under `src/`.
- **Manifest:** `package.json` (version, `peerDependencies`), `tests/manifest.test.ts`, and a new release-metadata test.
- **Docs updated:** `README.md`, `CHANGELOG.md` (new), `docs/README.md`, `docs/usage-guide.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/scenarios.md` (new), `docs/evidence/<date>-release.md` (new).
- **Operator actions:** approve the report-pass cost after its dry run, which costs nothing. Separately approve pushing the branch and the `v0.1.0` tag. After the push, run the manual tag install into an empty `PI_CODING_AGENT_DIR`.
- **Dependencies:** none added. `typebox` is already in the lockfile through the host package.
