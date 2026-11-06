## Why

WG-07 (main effort) and WG-11 (worker routing) rely on host seams that `docs/architecture.md` marks **verify**, plus behaviors no documentation settles: whether `tool_call` input mutation reaches a child, when `message_end` runs relative to `tool_call` preflight, whether a child can remove tools, and how thinking changes affect the prompt cache. Building on a wrong assumption would mean reworking a large work group. Verifying now costs a document edit at most, and leaves a host-test harness the later groups need anyway.

## What Changes

- Add a host-test harness under `tests/host/`. It runs the real Pi CLI in RPC mode in an isolated `PI_CODING_AGENT_DIR` with the pinned executor, against a loopback HTTP provider that records every request and answers from a script.
- Add test-only probe extensions that exercise each seam through public APIs.
- Add host tests that answer WG-02 questions 1 to 7 from what the provider fixture received. They run in CI with no secrets and no network beyond loopback.
- Add a documented manual procedure for question 8, which makes a few real calls to `claude-code/claude-haiku-5-5` outside CI.
- Add an evidence report in `docs/evidence/` with an answer, its supporting run, its testing level and the tested versions for each question.
- Add `@gotgenes/pi-subagents` `25.0.5` as an exact-pinned devDependency.
- Update the documents an answer contradicts, and replace the **verify** markers in the host seams table with the verified status.
- No package behavior changes: `src/extension.ts` stays a no-op.

## Capabilities

### New Capabilities
- `host-test-harness`: running the real Pi CLI with the pinned executor against a recording loopback provider in an isolated agent dir, so host tests can assert on what reaches the provider.
- `host-seam-evidence`: the evidence each WG-02 question needs, the host tests that protect the answers that later groups depend on, and the report that records them.

### Modified Capabilities
None. Host tests run through the existing `bun run test` script and stay within the `quality-checks` limits (no secrets, loopback only).

## Impact

- **Code:** new `tests/host/` (harness, provider fixture, probe extensions, tests). No change to `src/`.
- **Dependencies:** `@gotgenes/pi-subagents` `25.0.5` as a devDependency; `bun.lock` updated. Q8 installs `git:github.com/earendil-works/pi-claude-code` at commit `47f9e2b` into a temporary agent dir only, not into the repository.
- **CI:** `bun run test` gains the host tests, which are slower than the unit tests.
- **Docs updated:** `docs/evidence/` (new report), `docs/architecture.md` (host seams table, and child detection if contradicted), `docs/roadmap.md` (WG-02 status, and any later group an answer changes), `docs/testing.md` (harness and Q8 procedure, if they change what it states). `docs/decisions/` gains an ADR only if an answer reverses a decision.
