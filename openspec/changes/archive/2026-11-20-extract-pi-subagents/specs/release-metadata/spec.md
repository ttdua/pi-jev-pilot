## MODIFIED Requirements

### Requirement: Install commands are pinned to the release tag
Every `pi install git:github.com/ttdua/pi-jev-pilot` command in `README.md` and `docs/usage-guide.md` SHALL end in `@v<version>`, where `<version>` is the `version` in `package.json`. Each of those files SHALL also contain a `pi install git:github.com/ttdua/pi-subagents@v<tag>` command whose `<tag>` equals the release tag pinned in `devDependencies["@ttdua/pi-subagents"]`, placed before the jev-pilot install command, and SHALL say that worker routing needs it.

#### Scenario: Pinned install
- **WHEN** `README.md` and `docs/usage-guide.md` are read with version `0.6.0` and the executor pinned to `v0.1.1`
- **THEN** each install command of the package reads `pi install git:github.com/ttdua/pi-jev-pilot@v0.6.0`, each file has `pi install git:github.com/ttdua/pi-subagents@v0.1.1` before it, and at least one of each exists in each file

#### Scenario: Unpinned install fails
- **WHEN** a fixture README contains `pi install git:github.com/ttdua/pi-jev-pilot` with no ref
- **THEN** the release check reports the unpinned line

#### Scenario: Executor install drifts from the pin
- **WHEN** a fixture README contains `pi install git:github.com/ttdua/pi-subagents@v0.1.0` while the dev dependency pins `v0.1.1`
- **THEN** the release check reports the executor install line
