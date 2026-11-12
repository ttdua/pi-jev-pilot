## MODIFIED Requirements

### Requirement: Vendored tests run on their own
The vendored package SHALL keep its own unit tests and type check. A root script `test:executor` SHALL run them. The root `test` script MUST NOT run them, and jev-pilot's lint, type check, function-size rules and import-graph test MUST NOT cover `packages/`. The CI workflow SHALL run both `test` and `test:executor`. As the final step of the same job, after `test:executor`, it SHALL run the vendored package's `verify:public-types` script, which packs the package and type-checks an external consumer against its packed declarations. The root `test` and `test:executor` scripts MUST NOT run `verify:public-types`.

#### Scenario: Executor suite runs from the root
- **WHEN** `bun run test:executor` runs on the committed tree
- **THEN** the vendored package's unit tests and type check run and exit with code 0

#### Scenario: jev-pilot checks skip the vendored tree
- **WHEN** `bun run lint` and `bun run typecheck` run
- **THEN** no file under `packages/` is checked

#### Scenario: CI checks the published declarations
- **WHEN** the CI workflow is read
- **THEN** the job that runs `bun run test:executor` ends with a step that runs `bun run --cwd packages/pi-subagents verify:public-types`

#### Scenario: Public types check passes on the committed tree
- **WHEN** `bun run --cwd packages/pi-subagents verify:public-types` runs on the committed tree
- **THEN** it packs `@ttdua/pi-subagents`, type-checks the consumer probe against the packed declarations and exits with code 0
