## ADDED Requirements

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

### Requirement: Scenario documentation links its evidence
`docs/scenarios.md` SHALL have one section for each of four scenarios: effort follows the prompt, worker model follows difficulty, the reviewer slot, and which rule wins. Each of the first three MUST link to the release evidence file in `docs/evidence/`. `README.md` MUST link to `docs/scenarios.md`.

#### Scenario: Links present
- **WHEN** `docs/scenarios.md` and `README.md` are read
- **THEN** the three measured sections each contain a link into `docs/evidence/`, and `README.md` contains a link to `docs/scenarios.md`
