# CI public-types check Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** CI runs the vendored executor's `verify:public-types` script as the last step of its existing job, guarded by a repository test.

**Architecture:** One added `run` step at the end of the `check` job in `.github/workflows/ci.yml`. `tests/ci.test.ts`, which already pins the ordered CI commands, gains the step, an assertion, over the `check` job's step blocks, that it is the job's last step, and an assertion that the local `test`/`test:executor` scripts do not run it.

**Tech Stack:** GitHub Actions, Bun 1.4.4 (`bun:test`), bash.

## Global Constraints

- Command, verbatim: `bun run --cwd packages/pi-subagents verify:public-types`.
- It runs after `bun run test:executor`, as the final step of the same job.
- The root `test` and `test:executor` scripts MUST NOT run `verify:public-types`.
- Tests need no secrets, paid calls or network beyond loopback: the repository test reads files only; the script itself (which installs from the registry) runs in CI and by hand, never inside `bun test`.
- Depends on the #68 fix (`b0681ac0`), already in this branch's history.

## Review Focus

- A later edit appends a step (`uses:`, or a named `run:`) after the check: the "last step" assertion must fail, not just the relative-order check.
- The command appears only in a comment or in another job: the assertion must read the step blocks of the `check` job only.
- Someone folds the check into `test:executor` for convenience: the package.json assertion must fail.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `.github/workflows/ci.yml` `check` job steps | modified | existing steps, then `- run: bun run --cwd packages/pi-subagents verify:public-types` as the last step | no |

---

## Task 1: CI runs the public-types check — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `tests/ci.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/testing.md`

**Interfaces:** contract `.github/workflows/ci.yml check job steps`.

- [ ] **Step 1: Write the failing tests** in `tests/ci.test.ts`:
  - In `"CI runs every check"`, append `"bun run --cwd packages/pi-subagents verify:public-types"` to `commands` (after `"bun run test:executor"`).
  - New helper in `tests/ci.test.ts`, `checkJobSteps(text: string): string[]`: take the lines from `  check:` up to the next line matching `/^  \S/` (next job) or EOF; split them into step blocks, each starting at a line matching `/^      - /` (six spaces, the current step indentation) and running to the next such line; return each block as its joined text. No YAML dependency.
  - New test `"the public-types check is the last step of the check job"`: with `steps = checkJobSteps(text)`, expect the last block to match `/^\s*-?\s*run: bun run --cwd packages\/pi-subagents verify:public-types\s*$/m`, and expect some earlier block to contain `run: bun run test:executor`.
  - Separate test `"checkJobSteps bounds the check job"`, a self-check of the helper: `checkJobSteps(text + "      - uses: actions/cache@v4\n")` has a last block that does not contain `verify:public-types`, and a workflow string whose public-types step sits under a second job (`  other:` … ) yields no `check` block with it.
  - In `"lint and typecheck cover nothing under packages/"` (or a new test `"local test scripts skip the public-types check"`): expect `pkg.scripts.test` and `pkg.scripts["test:executor"]` not to contain `verify:public-types`.
- [ ] **Step 2: Run** `bun test tests/ci.test.ts`. Expected: "CI runs every check" FAILS (command missing, position -1) and "the public-types check is the last step of the check job" FAILS on its first expectation (last block is `test:executor`); "checkJobSteps bounds the check job" and the package.json assertion pass.
- [ ] **Step 3: Add** `- run: bun run --cwd packages/pi-subagents verify:public-types` after `- run: bun run test:executor` in `.github/workflows/ci.yml`, same indentation.
- [ ] **Step 4: Run** `bun test tests/ci.test.ts`. Expected: PASS.
- [ ] **Step 5: Update** `docs/testing.md`, "Vendored executor": one or two sentences — `bun run --cwd packages/pi-subagents verify:public-types` packs the executor and type-checks an external consumer against the packed `dist/*.d.ts`; it needs registry access, so it is not part of `test` or `test:executor`; CI runs it last.
- [ ] **Step 6: Verify** `bun run --cwd packages/pi-subagents verify:public-types` exits 0; then `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun run test`, `bun run test:executor` all exit 0.
- [ ] **Step 7: Commit**

```bash
git add tests/ci.test.ts .github/workflows/ci.yml docs/testing.md
git commit -m "ci: run the executor's public-types check"
```

- [ ] **Step 8: Verify the committed tree**: with a clean `git status`, run `bun run --cwd packages/pi-subagents verify:public-types` again; record the commit SHA and exit code 0 in `apply.md`.

---

## Scenario → test

- Executor suite runs from the root → existing CI step `bun run test:executor` (exit 0), unchanged.
- jev-pilot checks skip the vendored tree → existing `tests/ci.test.ts` "lint and typecheck cover nothing under packages/".
- CI checks the published declarations → `tests/ci.test.ts` "CI runs every check" (ordered after `test:executor`) and "the public-types check is the last step of the check job".
- Public types check passes on the committed tree → the CI step itself, and Step 8's run on the committed tree; not a `bun test` case, because the script installs from the registry (network rule).
