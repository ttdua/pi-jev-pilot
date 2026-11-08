## 1. Manifest and release metadata

- [x] 1.1 Add `typebox: "*"` to `peerDependencies` in `package.json`, and extend `tests/manifest.test.ts` (exact peer set, every imported host package declared)
- [x] 1.2 Add `tests/release.test.ts` with a pure checker for the changelog entry, pinned install lines and banners, plus fixture cases for missing entry and unpinned line
- [x] 1.3 Set `package.json` version `0.1.0` and add `CHANGELOG.md` with the `## [0.1.0]` entry naming `v0.1.0`

## 2. Replay report pass

- [x] 2.1 Accept `--pass report` in `scripts/replay/config.ts` (usage text, unknown pass message, `--only` refused), with tests in `tests/replay/cli.test.ts`
- [x] 2.2 Plan the report pass in `scripts/replay/variants.ts`: `report` and `rerun` per kind, shipped main groups, configured worker questions, exclusions and skip, with tests in `tests/replay/variants.test.ts`
- [x] 2.3 Add `scripts/replay/report.ts`: per-mode, per-routing worker routing with a rolling cut-point window, slot launches kept out, main effort decisions, with tests in `tests/replay/report.test.ts`
- [x] 2.4 Aggregate the report in `scripts/replay/report.ts`: effort distribution and lowered/same/raised against start and most common start, tier/slot/reason counts, reviewer share by worker kind, run-vs-rerun noise, misses, and differing cases
- [x] 2.5 Wire the report pass into `scripts/replay/cli.ts` (dry run, send, outputs), with loopback-fixture tests for dry run, send, all-miss and the private marker
- [x] 2.6 Document the report pass in `docs/testing.md` (replay section, command, outputs)

## 3. Real run (operator)

- [x] 3.1 Take the capabilities snapshot and run the report dry run; send the printed counts and cost to the operator and wait for approval
- [x] 3.2 After approval, run the report with `--send`; keep `cases.md` private
- [x] 3.3 Write `docs/evidence/<date>-release.md` with the aggregates, method, noise and read-with-care notes

## 4. Documentation

- [x] 4.1 Write `docs/scenarios.md`: four sections (effort, worker model by mode, reviewer slot, which rule wins), each measured section linking the evidence
- [x] 4.2 Rewrite `README.md`: short intro, pinned install, check it works, scenario table with headline numbers, links
- [x] 4.3 Remove banners from `docs/README.md` and `docs/usage-guide.md`, pin the install command, and link `docs/scenarios.md` and the new evidence from `docs/README.md`
- [x] 4.4 Update `docs/roadmap.md`: WG-19 "Done when" reworded to the git-tag install, status Done after acceptance
- [x] 4.5 Run the full check suite (`bun run typecheck`, `lint`, `fmt:check`, `test`)
- [x] 4.6 Fold the features merged from `main` after planning (CLI review on/off toggle #48, per-directory mode #49) into `CHANGELOG.md`, `README.md`, `docs/scenarios.md` (inside the existing four sections) and the release evidence notes; run the full check suite

## 5. Release acceptance (operator)

- [ ] 5.1 With the operator's go-ahead, push the branch and the `v0.1.0` tag
- [ ] 5.2 The operator runs `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0` into an empty `PI_CODING_AGENT_DIR` and checks the four acceptance points; record versions and results in the evidence file
