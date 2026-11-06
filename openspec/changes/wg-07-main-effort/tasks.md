## 0. Setup

- [x] 0.1 Run `bun install` in the worktree (its `node_modules` lacks `.bin/pi` and most of `pi-coding-agent/dist/core`), then confirm `bun test tests/load.test.ts` passes before any change.

## 1. Effort policy (pure)

- [x] 1.1 Add `src/policy/effort.ts`: `EFFORT_LEVELS`, `RISK_FLOOR` (0.7), `EFFORT_CEILING` (`xhigh`), `CORRECTION_THRESHOLD` (0.7); `supportedLevels({ reasoning, thinkingLevelMap })`; `decideEffort({ choice, risky, supported })` → `{ requested, target }` with floor, ceiling and clamp (nearest above, else below) (specs/main-effort: Supported levels, Effort rule). Unit tests in `tests/policy/effort.test.ts`, one per scenario, plus a table pinned from Pi 1.5.0's `getSupportedThinkingLevels`/`clampThinkingLevel`.

## 2. Questions and state (pure, `jev/`)

- [x] 2.1 Add `src/jev/questions.ts`: `mainQuestions({ askEffort })` returning the wire `questions` (`effort`, `risky`, `corrects`, wording from `docs/jev-questions.md`) and the matching `QuestionSpec` map for `readAnswers` (specs/main-effort: Main questions, Question wire format). Unit tests in `tests/jev/questions.test.ts`.
- [ ] 2.2 Add `src/jev/state.ts`: `requestSignals(prompt)` (specs/main-state: Request signals). Unit tests in `tests/jev/state.test.ts`.
- [ ] 2.3 Add `recentMessages(items)` with the 4-message, 2000-character budget, newest-assistant share and oldest-first dropping (specs/main-state: Recent conversation, Recent conversation budget).
- [ ] 2.4 Add `recentTools(items)` and `turnIndex(items)` (specs/main-state: Recent tool counts and turn index), and `mainState({ prompt, items, platforms })` with the exact field set (Minimal main state).

## 3. Host context

- [ ] 3.1 Add `src/host/context.ts`: `branchItems(entries)` turning `getBranch()` entries into plain items (user and assistant text, tool calls joined with results by id, custom messages skipped); `previousTurnId(entries)` (newest valid `jev-turn` custom entry). Unit tests in `tests/host/context.test.ts` with hand-built entries.
- [ ] 3.2 Add `scanPlatforms(cwd)` (marker table, one level down, skips, symlinks, unreadable directories) (specs/main-state: Workspace platforms). Unit tests against temporary directories.

## 4. Main decision handlers

- [ ] 4.1 Add `src/host/main.ts` with an injectable `MainDeps` (snapshot loader, `askJev`, `appendLedger`, clock, id source, branch reader, platform scan) and the `before_agent_start` handler: eligibility, `from`, request, answer reading, discard check, `max` kept, apply and read back (specs/main-effort: Eligible main prompts, Level applied before the first request, Max is kept, Discarded on a manual change, Jev failure changes nothing). Unit tests in `tests/host/main.test.ts` with a fake `pi` and `ctx`.
- [ ] 4.2 Add `before_provider_request` (marks `sawRequest`) and the Esc restore at `agent_settled` with the restore guard; `cancelled` from the client changes nothing (specs/main-effort: Cancelled turn starts nothing). Unit tests.
- [ ] 4.3 Add `turn_end` counting and the `agent_settled` ledger path: `outcome`, `durationMs`, `correction` line before `main`, then `appendEntry("jev-turn", { turnId })` (specs/main-ledger). Unit tests that validate every written line with `validateLedgerEntry`.
- [ ] 4.4 Wrap every handler in `try`/`catch`; add the unit test with a throwing branch reader (specs/main-effort: Handler failures stay inside the package).

## 5. Status line and wiring

- [ ] 5.1 Extend `statusText(snapshot, decision?)` and `drawStatus` in `src/host/status.ts` with the suffix rules; keep the last decision in the `main.ts` instance, clear it on `session_start`, and use it in the `/jev` redraw (specs/status-line). Update `tests/host/status.test.ts` for every new scenario.
- [ ] 5.2 Register the four new handlers in `src/host/setup.ts`; update `tests/load.test.ts` for the bounded registrations (specs/package-loading).

## 6. Host tests through the real CLI

- [ ] 6.1 Extend `tests/jev/fixture.ts` with a held route that answers only when the test releases it, and let the host harness point `classifier.url` at it and set the key in the isolated environment.
- [ ] 6.2 Add `tests/host/main-effort.test.ts` (RPC): `effort` `xhigh` reaches the first provider request; `risky` 0.8 with `low` gives `high`; `max` set by the operator is kept; the status line shows `Jev · standard · xhigh` before the first provider request.
- [ ] 6.3 Jev down: HTTP 500 and a held route with `timeoutMs` 300; provider requests equal a run without the package; first request within 800 ms; `Jev · standard · no answer`; one `main` line with `answered` false.
- [ ] 6.4 Esc and discard: RPC `abort` while Jev is held gives no provider request, the level restored, no ledger line; RPC `set_thinking_level` while Jev is held gives the operator's level on the first request and a line without `effective`.
- [ ] 6.5 Ledger and privacy: two prompts with `corrects` 0.9 on the second give a `correction` line naming the first `turnId`; a `JEV-MARKER-` prompt string appears in no ledger file and no `jev-turn` entry.

## 7. Upstream issue

- [ ] 7.1 Draft `openspec/changes/wg-07-main-effort/upstream-issue.md` for Pi: `ctx.signal` is undefined in `before_agent_start`, why that matters, and the requested change (a signal that aborts when the starting run is aborted). Do not post it; the operator decides.

## 8. Documentation

- [ ] 8.1 Update `docs/evidence/2026-11-05-host-seams.md` with the `before_agent_start` signal finding (source reading at Pi 1.5.0, and the host test from 6.4).
- [ ] 8.2 Update `docs/architecture.md` (host seams rows for `before_provider_request` and `agent_settled`; failure model row for Esc), `docs/workflow.md` (main prompt flow: restore on Esc, status line), `docs/usage-guide.md` (decision text on the status line), `docs/jev-questions.md` (wire format `instructions` and `criteria`), `docs/roadmap.md` (WG-07 status).
- [ ] 8.3 After archive, update the Purpose lines of `openspec/specs/package-loading/spec.md` and `openspec/specs/status-line/spec.md`.

## 9. Checks

- [ ] 9.1 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass with no secrets and no network beyond loopback.
