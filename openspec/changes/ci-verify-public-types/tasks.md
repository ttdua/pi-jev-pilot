## 1. CI runs the public-types check

Blocked by: none

- [ ] 1.1 Extend `tests/ci.test.ts`: the last step of the CI workflow's `check` job (parsed as step blocks of that job only) is `bun run --cwd packages/pi-subagents verify:public-types`, after `bun run test:executor`; the root `test` and `test:executor` scripts do not run `verify:public-types`
- [ ] 1.2 Add the step as the last step of the `check` job in `.github/workflows/ci.yml`
- [ ] 1.3 Describe the check in the "Vendored executor" section of `docs/testing.md`
- [ ] 1.4 Run `bun run --cwd packages/pi-subagents verify:public-types` before the commit and again on the committed tree, and confirm exit code 0
