## 1. Pure text in `src/host/status.ts`

- [x] 1.1 Add `Tally` type plus `compactTally(t)` and `tallyLines(t)` (compact status form and `/jev` `session:` block) with unit tests in `tests/host/status.test.ts`
- [x] 1.2 Add `logLine(data)` for `main`, `worker` and `correction` lines (validated with `validateLedgerEntry`, `undefined` otherwise) with unit tests for every verbose-log text scenario
- [x] 1.3 Extend `statusText`/`drawStatus` with an optional overlay that replaces the level suffix only in the `Jev · <mode>` form; base states still win

## 2. Session observer `src/host/tally.ts`

- [x] 2.1 `createSessionLog(pi, deps)` with `reset(sessionId)`, `record(line)`, `tally()`, `prompts()`; counts per session-tally spec (prompts, workers by model and `unrouted`, worker tokens, fallbacks), session-id guard, invalid lines ignored; unit tests in `tests/host/tally.test.ts`
- [x] 2.2 In `record`, append `jev-log` with the validated line while the snapshot's `verbose` is on; swallow `appendEntry` failures; unit tests for off/on/mid-session/correction order/throwing

## 3. Wiring

- [ ] 3.1 `src/host/setup.ts`: create the observer, wrap `appendLedger` for `createMain` and `registerWorkerRouting` (`deps.append`), reset on main `session_start`, register the `jev-log` entry renderer (one line cut to width, try/catch)
- [ ] 3.2 `src/host/main.ts`: `tallyText` dependency, overlay set after a completed (not cancelled) Jev request on the 10th, 20th, ... prompt and cleared at the next eligible prompt start; `overlay()` accessor; `sessionStart` clears it; unit tests in `tests/host/main.test.ts` for prompts 9, 10, 11, miss, discarded, effort off
- [x] 3.3 `src/host/commands.ts`: `tally` and `overlay` deps; `formatStatus` ends with the `session:` block; `drawStatus` redraws with the overlay; update `tests/host/commands.test.ts` (empty tally, tally after work, overlay kept across `/jev`)

## 4. Host test

- [ ] 4.1 `tests/host/verbose-log.test.ts`: real host session with `verbose` on in `state.json`, two prompts; the session file holds a `jev-log` entry equal to the first `main` ledger line, and the second provider request contains neither `jev-log` nor that line's `turnId`; a run with default switches writes no `jev-log` entry

## 5. Docs and checks

- [ ] 5.1 Update `docs/architecture.md` (Display surfaces: tally content without tools, log gated by `verbose`), `docs/usage-guide.md` (tally in `/jev`, what `verbose` shows, drop "WG-17" markers), `docs/privacy.md` (log entries stored in session files, labels and numbers only), `docs/glossary.md` (Log line), `docs/roadmap.md` (WG-17 Done)
- [ ] 5.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test` and fix anything they report
