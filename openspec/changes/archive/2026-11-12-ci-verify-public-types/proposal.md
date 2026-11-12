## Why

The vendored executor's `verify:public-types` script, which proves its packed declaration bundle type-checks for an external consumer, was broken from the package rename until #68, and nothing noticed because CI never ran it. jev-pilot imports executor types, so a broken bundle is a real regression. Running the check in CI catches it on the push that causes it.

## What Changes

**CI checks**
- From: CI runs `test` and `test:executor` (plus install, typecheck, lint, format).
- To: CI also runs `bun run --cwd packages/pi-subagents verify:public-types`, as the last step of the existing job.
- Reason: `test:executor` type-checks the sources, not the packed `dist/*.d.ts` an external consumer resolves.
- Impact: non-breaking; CI takes a little longer and needs registry access for the consumer install, as `bun install` already does. Local `test` and `test:executor` are unchanged.

`tests/ci.test.ts` asserts the new step is present and last. `docs/testing.md` describes it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `executor-vendoring`: "Vendored tests run on their own" — CI also runs the vendored package's public-types check, after `test:executor`.

## Impact

- `.github/workflows/ci.yml`: one added step.
- `tests/ci.test.ts`: the expected ordered command list gains the step.
- docs/ files updated: `docs/testing.md` ("Vendored executor" section).
- Depends on the #68 fix (`fix/68`, `b0681ac0`), which this branch is based on.
