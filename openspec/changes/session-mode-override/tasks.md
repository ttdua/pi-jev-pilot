## 1. Resolver session layer (iteration 1)

- [x] 1.1 Add the optional `sessionMode` input to `resolveSettings` and return `mode`, `modeSource` and `savedMode`, with store tests (superseded in 8.1)

## 2. Session entry reader (iteration 1)

- [x] 2.1 Add a pure reader of `jev-mode` session entries in `src/jev/` (removed in 10.1)

## 3. Host holder and snapshot (iteration 1)

- [x] 3.1 Add `src/host/session-mode.ts`, an in-memory holder tagged with its session id (removed in 10.1)
- [x] 3.2 Make `loadSnapshot` pass the holder's mode to the resolver (replaced in 9.2)
- [x] 3.3 Rebuild the holder at main `session_start` and `session_tree` (removed in 10.1)

## 4. Command forms (iteration 1)

- [x] 4.1 Parse `/jev mode <m> session` and `/jev mode session off` (replaced in 11.1)
- [x] 4.2 Run the set and clear forms through session entries (replaced in 11.2)
- [x] 4.3 Saving while a session mode is set keeps it (replaced in 11.3)
- [x] 4.4 `/jev reset` clears the session mode (replaced in 11.4)

## 5. Visible text (iteration 1)

- [x] 5.1 Status line `(session)` marker (renamed in 12.1)
- [x] 5.2 `/jev` report session line (renamed in 12.1)

## 6. End-to-end host tests (iteration 1)

- [x] 6.1 RPC tests for resume, fork, new session, routing and other process (replaced in 13.1)

## 7. Docs (iteration 1)

- [x] 7.1 Document the session mode (rewritten in 14.1)
- [x] 7.2 Full check

## 8. Resolver directory layer

- [x] 8.1 Rename the resolver input to `localMode` and the result fields to `modeSource: "local" | "global"` and `globalMode`, updating store tests to the `settings-resolution` scenarios "Directory mode over state", "Directory mode over the default" and "Directory mode changes only the mode" (design D1)

## 9. Directory mode file and snapshot

- [x] 9.1 Add `src/store/local-mode.ts` with `readLocalMode`, `writeLocalMode` and `clearLocalMode` for `<cwd>/.pi/jev-mode.json`, including validation and problems by field path (`directory-mode` "Directory mode file", "Damaged directory mode file"; design D2), with store tests
- [x] 9.2 Add the main-cwd holder (`src/host/main-cwd.ts`), set at main `session_start` only, and make `loadSnapshot(pi, cwd?)` read the directory mode on every call and report its problems in the snapshot (`directory-mode` "Directory mode applies to every session in the directory", "Inert in a child session"; design D3, D6)

## 10. Remove the session-entry code

- [x] 10.1 Delete `src/jev/session-mode.ts`, `src/host/session-mode.ts`, the `session_tree` handler and their tests; drop `ensure` and `rebuild` calls from `setup.ts` and `commands.ts`, and `session_tree` from the handler lists in `tests/host/setup.test.ts` and `tests/load.test.ts`

## 11. Command forms

- [x] 11.1 Parse `/jev mode <m>` (local), `/jev mode <m> global` and `/jev mode clear`; every other form is usage; update the usage text (`jev-command` "Usage text for other input"; design D4)
- [x] 11.2 Run the local set and clear: write or remove the file through `ctx.cwd`, report the error code and file path on failure, `no directory mode set` when there is nothing to clear, never touch `state.json` (`directory-mode` "Set the directory mode", "Clear the directory mode")
- [x] 11.3 Global set: write `state.json`; while a directory mode is set, keep it and add `directory mode <d> still applies here; global mode is now <m>` (`jev-command` "Mode"; design D5)
- [x] 11.4 `/jev reset` removes the directory mode file only after a successful state reset (`jev-command` "Reset"; design D5)

## 12. Visible text

- [ ] 12.1 Status line `(local)` marker; `/jev` report `mode: <m> (this directory; global <g>)` and the `local mode (...)` problem lines (`status-line` "Status line text", `jev-command` "Status report"; design D6, D7)

## 13. End-to-end host tests

- [ ] 13.1 Replace `tests/host/session-mode-e2e.test.ts` with RPC tests for the directory mode: new session in the same directory, set before the first message then restart, other directory keeps the global mode, second process sees a change, worker routed with the directory mode (child model and ledger `mode`), and `.gitignore` untouched

## 14. Docs

- [ ] 14.1 Rewrite the docs for the directory mode and the breaking change: `docs/usage-guide.md` (commands, `git status` warning, breaking change), `README.md`, `docs/architecture.md` (precedence, `src/store/local-mode.ts`, `src/host/main-cwd.ts`, the file) and `docs/glossary.md` (directory mode)
- [ ] 14.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass
