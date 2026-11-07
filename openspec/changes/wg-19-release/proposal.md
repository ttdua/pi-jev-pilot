## Why

Every work group before WG-19 is done and the operator already runs the package from git, but the documents still say "design phase, no code yet". A new user cannot see what the package does for them, how to install a stable version, or which rule wins when several apply. The 0.1 release should answer those questions with numbers from the code that ships, measured on real sessions, so the README makes no claim it cannot back.

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
- Reason: the README scenarios need numbers that match 0.1.
- Impact: non-breaking. Pass 1 is unchanged.

**Documentation**
- A short `README.md`: what the package is, install, how to check it works, a table of four scenarios with their headline numbers, and links.
- A new `docs/scenarios.md` with one section per scenario: effort follows the prompt, worker model follows difficulty, the reviewer slot, and which rule wins for model, effort and config values.
- A new evidence file in `docs/evidence/` with the report-pass aggregates and the manual install check of the tag.
- The "design phase" and "planned behavior" banners removed.

**Not in scope:** a migration guide from the earlier port (by operator decision), an npm publish, a tarball, and any change to decision behavior.

## Capabilities

### New Capabilities
- `release-metadata`: the release version, its changelog entry and the pinned install command stay consistent across `package.json`, `CHANGELOG.md`, `README.md` and the usage guide.

### Modified Capabilities
- `package-loading`: *Package manifest* adds `typebox` as a second allowed `"*"` peer dependency.
- `state-replay`: a report pass is added beside pass 1, with its own plan, per-mode worker routing, distribution aggregates and noise rerun. The existing requirements still hold for pass 1.

## Impact

- **Code:** `scripts/replay/` (`config.ts`, `cli.ts`, `variants.ts`, a new `report.ts`) with tests in `tests/replay/`. No change under `src/`.
- **Manifest:** `package.json` (version, `peerDependencies`), `tests/manifest.test.ts`, and a new release-metadata test.
- **Docs updated:** `README.md`, `CHANGELOG.md` (new), `docs/README.md`, `docs/usage-guide.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/scenarios.md` (new), `docs/evidence/<date>-release.md` (new).
- **Operator actions:** approve the report-pass cost after its dry run, which costs nothing. Separately approve pushing the branch and the `v0.1.0` tag. After the push, run the manual tag install into an empty `PI_CODING_AGENT_DIR`.
- **Dependencies:** none added. `typebox` is already in the lockfile through the host package.
