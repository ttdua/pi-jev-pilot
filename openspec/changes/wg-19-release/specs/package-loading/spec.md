## MODIFIED Requirements

### Requirement: Package manifest
The repository root `package.json` SHALL declare a Pi package whose `pi.extensions` lists exactly `./src/extension.ts`, whose `keywords` include `pi-package`, and whose `license` is `MIT`. Its `peerDependencies` SHALL be exactly the host-provided packages the source imports, `@earendil-works/pi-coding-agent` and `typebox`, each with the range `"*"`. Neither may be a runtime dependency. The package MUST have no runtime `dependencies`.

#### Scenario: Manifest names one entry point
- **WHEN** `package.json` is read
- **THEN** `pi.extensions` equals `["./src/extension.ts"]`, `keywords` contains `pi-package`, and `license` is `MIT`

#### Scenario: Host package is a peer, not bundled
- **WHEN** `package.json` is read
- **THEN** `peerDependencies` equals `{ "@earendil-works/pi-coding-agent": "*", "typebox": "*" }`, and `dependencies` is absent or empty

#### Scenario: Every imported host package is declared
- **WHEN** the non-relative imports under `src/` are listed, excluding `node:` built-ins
- **THEN** each imported package name is a key of `peerDependencies`
