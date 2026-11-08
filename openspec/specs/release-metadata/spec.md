# release-metadata Specification

## Purpose
The 0.1 release metadata and user-facing docs stay consistent: the version, its changelog entry and tag, install commands pinned to the release tag, no pre-release banners, scenario docs that describe behavior, no usage figures in user-facing docs, and a README that explains each feature's effect and how to turn it off.

## Requirements

### Requirement: Version has a changelog entry
`CHANGELOG.md` at the repository root SHALL hold a section headed `## [<version>]` for the `version` in `package.json`. The section MUST name the git tag `v<version>` and the date of the release. Sections MUST be in descending version order.

#### Scenario: Current version is in the changelog
- **WHEN** `package.json` has version `0.1.0`
- **THEN** `CHANGELOG.md` has a `## [0.1.0]` heading whose section contains `v0.1.0`

#### Scenario: Missing entry fails
- **WHEN** a fixture `package.json` has version `0.2.0` and the fixture changelog's newest heading is `## [0.1.0]`
- **THEN** the release check reports that `0.2.0` has no changelog entry

### Requirement: Install commands are pinned to the release tag
Every `pi install git:github.com/ttdua/pi-jev-pilot` command in `README.md` and `docs/usage-guide.md` SHALL end in `@v<version>`, where `<version>` is the `version` in `package.json`.

#### Scenario: Pinned install
- **WHEN** `README.md` and `docs/usage-guide.md` are read with version `0.1.0`
- **THEN** each install command of the package reads `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0`, and at least one exists in each file

#### Scenario: Unpinned install fails
- **WHEN** a fixture README contains `pi install git:github.com/ttdua/pi-jev-pilot` with no ref
- **THEN** the release check reports the unpinned line

### Requirement: No pre-release banner
`README.md` and the files under `docs/` other than `docs/evidence/` and `docs/decisions/` MUST NOT contain the phrases `design phase`, `no code yet`, `Nothing is installable` or `describes the planned behavior`.

#### Scenario: Banners removed
- **WHEN** `README.md` and those files are read
- **THEN** none contains any of the four phrases

### Requirement: Scenario documentation describes behavior
`docs/scenarios.md` SHALL have one section for each of four scenarios: effort follows the prompt, worker model follows difficulty, the reviewer slot, and which rule wins. `README.md` MUST link to `docs/scenarios.md`.

#### Scenario: Sections and link present
- **WHEN** `docs/scenarios.md` and `README.md` are read
- **THEN** `docs/scenarios.md` has exactly those four `##` sections, and `README.md` contains a link to `docs/scenarios.md`

### Requirement: No usage figures in user-facing docs
`README.md` and `docs/scenarios.md` MUST NOT contain measured usage figures. Neither file may contain a `%` sign or a link into `docs/evidence/`. Measured figures SHALL stay in the files under `docs/evidence/`.

#### Scenario: Docs free of figures
- **WHEN** `README.md` and `docs/scenarios.md` are read
- **THEN** neither contains `%` or `evidence/`

#### Scenario: Figure detected
- **WHEN** a fixture README contains `Jev chose low for 74% of prompts`
- **THEN** the release check reports the `%` in `README.md`

### Requirement: README explains each feature's effect
`README.md` SHALL have a section that, for each user-facing feature, says what changes in the user's sessions when it is on and how to turn it off. The features are effort, effort hold, skills, strategy advice, worker routing with modes, the expert tier, slots, tool assessment, the CLI review, tally and verbose log, auto-tuning, and the status line. The README MUST also state what never changes (the main model, fail open when Jev is unavailable, no prompt text stored) and the per-prompt latency.

#### Scenario: Every feature has an off switch
- **WHEN** `README.md` is read
- **THEN** it names the off command or setting of each of the six decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`) and of the CLI review (`/jev cli-review off`)
