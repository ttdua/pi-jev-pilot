## 1. Foundations

- [x] 1.1 Add `src/store/validate.ts`: issue type, path formatting, and combinators (known-key object, string pattern, integer range, enum, boolean, bounded array) that collect every issue without echoing values
- [x] 1.2 Add `src/store/atomic.ts`: create the jev dir `0700`, write temp `0600` + fsync + rename, keep an existing file's mode on request, remove the temp file on failure and return the error code
- [x] 1.3 Add `src/store/defaults.ts`: code defaults for every setting, the feature list, modes and reserved slot names from `docs/configuration.md` and `docs/usage-guide.md`

## 2. config.json

- [ ] 2.1 Add `readConfig(dir)` in `src/store/config.ts`: missing → ok not present; I/O error → invalid at `""`; bad JSON or non-object → invalid at `""`; unknown keys and field rules per `specs/config-file`; invalid carries no values
- [ ] 2.2 Add `writeSlots(dir, slots)`: refuse while invalid, validate the new list, replace only `crew.slots` keeping key order, add `crew` last, drop empty `crew`, create when missing, keep file mode
- [ ] 2.3 Add a source test that `src/store/` has no `process.env` reference and that `readConfig` never writes

## 3. state.json

- [ ] 3.1 Add `readState(dir)` in `src/store/state-file.ts`: ok, missing, malformed (no salvage), unreadable; schema per `specs/state-file`
- [ ] 3.2 Add `updateState(dir, mutate)` and `resetState(dir)`: refuse on unreadable, move a malformed file to `state.json.bad` (`0600`), validate the result, write atomically, return write failures as issues

## 4. Effective settings

- [ ] 4.1 Add `resolveSettings({ config, state, tuning? })` in `src/store/settings.ts`: pure, complete result, `tuning > state > config > default`, tuning limited to an integer `classifier.timeoutMs` in 300–5000

## 5. Host adapter

- [ ] 5.1 Add `src/host/stores.ts` with `jevDir()` from Pi's `getAgentDir()`, and tests for `PI_CODING_AGENT_DIR` and the default under a temporary `HOME`; leave `src/extension.ts` a no-op

## 6. Docs

- [ ] 6.1 Update `docs/configuration.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/usage-guide.md` and `docs/roadmap.md` as listed in `proposal.md`
