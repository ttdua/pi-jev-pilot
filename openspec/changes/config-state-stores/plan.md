# Config and State Stores Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Validated reads of `config.json` and `state.json`, atomic owner-only writes, one settings resolver, and a host adapter that locates `<agentDir>/jev/`.

**Architecture:** Pure-TypeScript modules in `src/store/` take the jev directory as a string, use sync `node:fs`, and return result unions instead of throwing. `src/host/stores.ts` is the only part that touches Pi: it calls `getAgentDir()`. `src/extension.ts` is not changed.

**Tech Stack:** TypeScript, Bun (`bun test`), `node:fs`, `node:path`, `node:crypto`; Pi `1.5.0` (`getAgentDir`) in `host/` only.

## Global Constraints

- No new dependency; `package.json` keeps no runtime `dependencies`.
- `src/store/` imports only `node:*` and its own files. It never reads `process.env` and never imports `@earendil-works/*` (lint enforces the import rule; Task 3 adds a test for the env rule).
- No store function throws to its caller. Failures come back as `Issue[]`.
- An issue message names the path and what was expected, never the value found.
- Expected values in tests come from `docs/configuration.md` and the specs, not from running the code.
- Tests use `tempDir()` from `tests/helpers.ts` and remove their directories. A test that sets a restrictive mode (`0o000`, `0o500`) restores `0o700`/`0o600` in `finally` before `rmSync`. Tests need no secrets and no network.
- Permission tests skip when `process.getuid?.() === 0`, because root ignores mode bits.
- Every task ends with `bun run typecheck && bun run lint && bun run fmt:check && bun run test` exiting 0.
- Commit messages follow the repository's style: `feat(store): …`, `test(store): …`, `docs: …`.

## Review Focus

1. **Value echo:** a validator message that interpolates the found value would leak a pasted key. Task 1 has the test `messages never contain the value`, run over every combinator.
2. **Prototype pollution:** `{"__proto__": …}` passes `JSON.parse` as an own key. The known-key check must use `Object.hasOwn` and copy only known keys. Task 3 has the test `prototype key`.
3. **Partial config acted on:** an `invalid` result that still carries values would let WG-06 half-apply a bad file. The `ConfigRead` type has no `config` on `invalid` (Task 3 test `invalid result has no values`).
4. **Temp file left behind:** an interrupted write leaves `*.tmp`. Task 2 tests both success and failure for leftover temp files.
5. **Transiently unreadable state destroyed:** an `EACCES` read must not trigger the `.bad` rename. Task 5 test `permission denied`.

---

## Contracts

All are package-internal. No public API, CLI or command changes in this change; the file formats are operator-facing.

| Name | new / modified | Shape | public |
|---|---|---|---|
| `config.json` format | new | As `docs/configuration.md`, strict: unknown keys rejected at every level; field rules in `specs/config-file` | yes (operator file) |
| `state.json` format | new | `{ version: 1; switches?: Partial<Record<Feature, boolean>>; mode?: Mode; cliReview?: { cli: "codex" \| "opencode"; model?: string; effort?: string } }`, written with 2-space indent and a final newline | yes (operator-visible file) |
| `state.json.bad` | new | Byte copy of the last malformed `state.json`, mode `0600`, never read | no |
| `Issue` | new | `{ path: string; message: string }` in `src/store/validate.ts` | no |
| Validator API | new | `src/store/validate.ts`: `type V<T> = (value: unknown, path: string, issues: Issue[]) => T \| undefined`; `object`, `string`, `integer`, `oneOf`, `boolean`, `array`, `joinPath` as in Task 1 | no |
| `slotsValidator` | new | `src/store/config.ts`: `V<Slot[]>` for `crew.slots`, shared by `readConfig` and `writeSlots` | no |
| `WriteResult` | new | `{ ok: true } \| { ok: false; issues: Issue[] }` in `src/store/validate.ts` | no |
| `Feature`, `Mode`, `Tier`, `FEATURES`, `MODES`, `TIERS`, `RESERVED_SLOT_NAMES`, `DEFAULTS` | new | `src/store/defaults.ts`. `FEATURES = ["effort","subagents","skills","strategy","tools","expert","review","status","verbose"]`; `MODES = ["budget","standard","premium"]`; `TIERS = ["fast","balanced","deep","expert"]`; reserved names as `docs/configuration.md` | no |
| `Config`, `Slot` | new | `src/store/config.ts`. `Slot = { name: string; model: string; when?: string }`; `Config` mirrors the documented sections, every field optional | no |
| `ConfigRead` | new | `{ kind: "ok"; present: boolean; config: Config } \| { kind: "invalid"; issues: Issue[] }` | no |
| `readConfig` | new | `readConfig(dir: string): ConfigRead` | no |
| `writeSlots` | new | `writeSlots(dir: string, slots: Slot[]): WriteResult` | no |
| `State` | new | `src/store/state-file.ts`: `{ switches?: Partial<Record<Feature, boolean>>; mode?: Mode; cliReview?: { cli: "codex" \| "opencode"; model?: string; effort?: string } }` (`version` is file-only) | no |
| `StateRead` | new | `{ kind: "ok"; state: State } \| { kind: "missing"; state: {} } \| { kind: "malformed"; state: {}; issues: Issue[] } \| { kind: "unreadable"; state: {}; issues: Issue[] }` | no |
| `readState`, `updateState`, `resetState` | new | `readState(dir: string): StateRead`; `updateState(dir: string, mutate: (s: State) => State): WriteResult`; `resetState(dir: string): WriteResult` | no |
| `writeFileAtomic` | new | `src/store/atomic.ts`: `writeFileAtomic(dir: string, name: string, data: string, opts?: { keepMode?: boolean }): { ok: true } \| { ok: false; code: string }` | no |
| `Tuning`, `Settings`, `resolveSettings` | new | `src/store/settings.ts`: `Tuning = { classifier?: { timeoutMs?: unknown } }`; `Settings` is `Config` with every field required (tiers as `Partial<Record<Tier,string>>`, `crew.slots: Slot[]`, `review: { cli; model?; effort? }`) plus `mode: Mode` and `switches: Record<Feature, boolean>`; `resolveSettings(input: { config: Config; state: State; tuning?: Tuning }): Settings` | no |
| `jevDir` | new | `src/host/stores.ts`: `jevDir(): string`, `join(getAgentDir(), "jev")` | no |

---

## Task 1: Validator core — implements 1.1, 1.3

**Files:**
- Create: `src/store/validate.ts`, `src/store/defaults.ts`
- Test: `tests/store/validate.test.ts`

**Interfaces:**
- Produces: `Issue`, `WriteResult`, and a validator type `V<T> = (value: unknown, path: string, issues: Issue[]) => T | undefined` with combinators `object(shape, { required? })`, `string({ pattern?, min?, max?, trim? })`, `integer({ min, max })`, `oneOf(values)`, `boolean()`, `array(item, { max?, uniqueBy? })`, and `joinPath(parent, key | index)` (`""` + `a` → `a`; `a` + `b` → `a.b`; `a` + `2` → `a[2]`). `object` rejects non-objects, arrays and `null`, reports each unknown own key at its path, and returns an object holding known keys only. The constants from `defaults.ts` are listed in Contracts. `DEFAULTS` holds the values listed in `specs/settings-resolution` "Everything defaulted".

- [ ] **Step 1: Write the failing tests.**
  - `joinPath formats dot and index`
  - `object reports every unknown key`: `{a:1,x:1,y:1}` with shape `{a}` gives issues at `x` and `y`.
  - `object rejects array and null`: issue at the given path.
  - `collects all issues`: two bad fields give two issues.
  - `messages never contain the value`: feed `"sk-test-0123456789abcdef"` to every combinator that rejects it, and assert that no message contains it.
  - `integer rejects 1500.5 and bounds`
  - `array uniqueBy reports the second duplicate at its index`
- [ ] **Step 2:** Run `bun test tests/store/validate.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `src/store/validate.ts` and `src/store/defaults.ts` per Interfaces. Use `Object.hasOwn` for key checks.
- [ ] **Step 4:** Run `bun test tests/store/validate.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): add validator combinators and defaults`.

## Task 2: Atomic writes — implements 1.2

**Files:**
- Create: `src/store/atomic.ts`
- Test: `tests/store/atomic.test.ts`

**Interfaces:**
- Produces: `writeFileAtomic` (Contracts). Steps: `mkdirSync(dir, { recursive: true, mode: 0o700 })`; write to `${name}.${process.pid}.${randomBytes(4).toString("hex")}.tmp` with `openSync(..., "wx", 0o600)`, then `writeSync`, `fsyncSync`, `closeSync`; when `keepMode` is set and the target exists, `chmodSync` the temp file to the target's mode; `renameSync` over the target. Any error removes the temp file (ignoring errors) and returns `{ ok: false, code: err.code ?? "EIO" }`.

- [ ] **Step 1: Write the failing tests.**
  - `created directory and file are owner-only`: the dir is `0o700` and the file is `0o600`, checked with `statSync(...).mode & 0o777`.
  - `existing mode kept with keepMode`: the target is `0o640` before and after.
  - `no temporary file after success`: `readdirSync(dir)` equals `[name]`.
  - `failed write leaves the target unchanged`: make `name` a non-empty directory. The result is `ok: false`, the directory is unchanged, and no `.tmp` entry remains.
  - `read-only directory returns EACCES`: the dir is `0o500`, and the result is `{ ok: false, code: "EACCES" }`. Skipped as root.
- [ ] **Step 2:** Run `bun test tests/store/atomic.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run `bun test tests/store/atomic.test.ts`. Expected: PASS.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): add atomic owner-only writes`.

## Task 3: Read config.json — implements 2.1, 2.3

**Files:**
- Create: `src/store/config.ts`
- Test: `tests/store/config-read.test.ts`, `tests/store/boundaries.test.ts`

**Interfaces:**
- Consumes: Task 1 combinators and constants.
- Produces: `Config`, `Slot`, `ConfigRead`, `readConfig`, and an exported `slotsValidator` that Task 4 reuses. The field rules are in the design D4 table and `specs/config-file`:
  - URL rule: `new URL()`; `protocol === "https:"`, or `"http:"` with `hostname` in `["127.0.0.1", "localhost", "[::1]"]`; empty `username` and `password`.
  - Slot name uniqueness: report the second occurrence.
  - `ENOENT` → `{ kind: "ok", present: false, config: {} }`. Any other read error → an invalid issue at `""` with message `cannot read config.json (<code>)`.

- [ ] **Step 1: Write the failing tests.** There is one test per `specs/config-file` scenario from "Valid full example" through "Enum values", plus "Read leaves the file untouched", each named after its scenario. The full example is copied verbatim from `docs/configuration.md`. "Unreadable file" uses mode `0o000` and expects a message containing `EACCES` (skipped as root). "Read leaves the file untouched" compares bytes and `mtimeMs`.
- [ ] **Step 2:** Write `tests/store/boundaries.test.ts`.
  - `stores read no environment`: the list of `.ts` files under `src/store/` is non-empty, and none matches `/process\.env/`. Comments in `src/store/` avoid that string.
  - `stores never import Pi`: the list is non-empty, and none matches `/from ["']@earendil-works\//`.
- [ ] **Step 3:** Run `bun test tests/store/config-read.test.ts tests/store/boundaries.test.ts`. Expected: `config-read` FAILS (module not found). `boundaries` already passes and guards later tasks.
- [ ] **Step 4:** Implement `readConfig`.
- [ ] **Step 5:** Run the same command. Expected: PASS.
- [ ] **Step 6:** Run the full check line, then commit `feat(store): read and validate config.json`.

## Task 4: Slot writer — implements 2.2

**Files:**
- Modify: `src/store/config.ts`
- Test: `tests/store/config-write.test.ts`

**Interfaces:**
- Consumes: `readConfig`, `slotsValidator`, `writeFileAtomic`.
- Produces: `writeSlots`. Steps:
  1. `readConfig`. If invalid, return its issues.
  2. Validate `slots` at path `crew.slots`.
  3. Re-parse the raw file text, or use `{}` when the file is absent, so the original key order is kept. Set `raw.crew = { ...raw.crew, slots }`; assigning a new key appends it last. For an empty list, delete `slots`, and delete `crew` if it is now empty. An empty list with no `config.json` writes nothing and returns `{ ok: true }`.
  4. Run `writeFileAtomic(dir, "config.json", JSON.stringify(raw, null, 2) + "\n", { keepMode: true })`. A failure becomes an issue at `""` naming the code.

- [ ] **Step 1: Write the failing tests**, one per scenario:
  - "Slot writer refuses an invalid file", "Other keys kept", "Invalid new slot refused", "New crew key goes last", "Last slot removed", "Created from nothing" (mode `0o600`).
  - From `store-location`: "Existing config mode is kept" (`0o640`).
  - "Other keys kept" compares `Object.keys` at every level against the original file.
  - `empty list without a file writes nothing`: no `config.json` exists afterwards.
- [ ] **Step 2:** Run `bun test tests/store/config-write.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `writeSlots`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): write crew.slots atomically`.

## Task 5: state.json — implements 3.1, 3.2

**Files:**
- Create: `src/store/state-file.ts`
- Test: `tests/store/state-file.test.ts`

**Interfaces:**
- Consumes: Task 1 combinators, `FEATURES`, `MODES`, `writeFileAtomic`.
- Produces: `State`, `StateRead`, `readState`, `updateState`, `resetState`.
  - Schema: `version` must be exactly `1`; `cliReview.model` and `cliReview.effort` use pattern `^[A-Za-z0-9._-]{1,64}$` and must not equal `default`.
  - `ENOENT` → `missing`. Any other read error → `unreadable`, issue message `cannot read state.json (<code>)`.
  - `updateState`:
    - `unreadable` → return its issues and touch nothing.
    - `malformed` → `renameSync(state.json, state.json.bad)` and `chmodSync(bad, 0o600)`, then start from `{}`. If either call fails, return an issue at `""` with the message `cannot move state.json aside (<code>)` and stop. Do not throw.
    - A `mutate` that throws is caught and returned as an issue at `""` with the message `update failed`. Nothing is written.
    - Otherwise start from `read.state`.
    - Apply `mutate`, then validate `{ version: 1, ...next }`. If invalid, return the issues.
    - Write with `writeFileAtomic`, then map a failure code to an issue at `""`.
  - `resetState` is `updateState(dir, () => ({}))`.

- [ ] **Step 1: Write the failing tests**, one per `specs/state-file` scenario, each named after it, plus "Read-only directory" from `store-location`.
  - "Permission denied": file mode `0o000`. Assert `kind === "unreadable"`, an issue containing `EACCES`, the update returns that issue, and `existsSync("state.json.bad")` is false. Skipped as root.
  - "Bad file moved aside": write `{"version":1,"mode":` (truncated), then update `mode: "premium"`. `.bad` bytes equal the original with mode `0o600`, and `state.json` parses to `{ version: 1, mode: "premium" }`.
  - `move aside fails without throwing`: a malformed `state.json` sits in a `0o500` directory. The update returns an issue containing `EACCES`, and `state.json` is unchanged. Skipped as root.
  - `throwing mutate is returned`: the update returns one issue, and the file is unchanged.
- [ ] **Step 2:** Run `bun test tests/store/state-file.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): read and write state.json with recovery`.

## Task 6: Settings resolver — implements 4.1

**Files:**
- Create: `src/store/settings.ts`
- Test: `tests/store/settings.test.ts`

**Interfaces:**
- Consumes: `Config`, `State`, `DEFAULTS`, `FEATURES`.
- Produces: `Tuning`, `Settings`, `resolveSettings`.
  - Every section is merged per field: `config` value, else `DEFAULTS`.
  - `classifier.timeoutMs`: the tuning value wins when it is an integer in 300–5000; otherwise the config value or the default.
  - `review`: `state.cliReview` when present, else `config.review` with its default.
  - `switches`: start from `DEFAULTS.switches` (all `true`, `verbose: false`), then apply `state.switches`.
  - `mode`: `state.mode ?? "standard"`.
  - Return fresh objects and arrays; never return references to the inputs.

- [ ] **Step 1: Write the failing tests**, one per `specs/settings-resolution` scenario, each named after it. "Everything defaulted" asserts the whole object with `toEqual`, using the literal values from the spec.
- [ ] **Step 2:** Run `bun test tests/store/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `resolveSettings`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): resolve effective settings`.

## Task 7: Host adapter — implements 5.1

**Files:**
- Create: `src/host/stores.ts`
- Test: `tests/host-stores.test.ts`

**Interfaces:**
- Consumes: `getAgentDir` from `@earendil-works/pi-coding-agent`.
- Produces: `jevDir(): string`.

- [ ] **Step 1: Write the failing tests.**
  - `PI_CODING_AGENT_DIR moves the files`: set it to a temp dir; expect `jevDir()` to be `join(temp, "jev")`.
  - `Default location`: delete `PI_CODING_AGENT_DIR` and set `HOME` to a temp dir; expect `join(HOME, ".pi", "agent", "jev")`.
  - Restore both variables in `afterEach`. Run in-process: `getAgentDir()` calls `homedir()` on each call (`dist/config.js`). If the in-process `Default location` test fails only because `homedir()` ignores the changed `HOME`, switch that one test to a `bun -e` subprocess with the env and read its stdout.
- [ ] **Step 2:** Run `bun test tests/host-stores.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `jevDir`. Leave `src/extension.ts` unchanged.
- [ ] **Step 4:** Run `bun test tests/host-stores.test.ts tests/load.test.ts`. Expected: PASS ("loaded extension registers nothing" still holds).
- [ ] **Step 5:** Run the full check line, then commit `feat(host): locate the jev directory through Pi`.

## Task 8: Docs — implements 6.1

**Files:**
- Modify: `docs/configuration.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/usage-guide.md`, `docs/roadmap.md`

- [ ] **Step 1:** Update `docs/configuration.md`:
  - `state.json` row: "Switches, mode, CLI review default".
  - A "Missing and malformed files" subsection: missing config means defaults; unknown keys are errors by path; a malformed or unreadable config makes the package inert; a malformed state means defaults and `state.json.bad` on the next change, with the problem reported to `/jev` for display; an unreadable state is left alone.
  - The `apiKeyEnv` name rule.
  - `review.cli` note: "`/jev cli-review` stores an override in `state.json`".
  - `crew.slots` note: slot commands rewrite `config.json` as plain 2-space JSON.
- [ ] **Step 2:** Update `docs/architecture.md`:
  - `store/` lines: `config.ts` reads and validates, and writes only `crew.slots`. Add `settings.ts` (precedence), `defaults.ts`, `atomic.ts`, `validate.ts`.
  - Failure model rows for a malformed and an unreadable `state.json`.
- [ ] **Step 3:** In `docs/domain-model.md`, change `reviewer default` to `CLI review default` in `Switches`. In `docs/usage-guide.md`:
  - `/jev reset` returns switches, mode and CLI review default to config defaults.
  - `/jev cli-review` keeps its choice in `state.json`.
- [ ] **Step 4:** In `docs/roadmap.md`, set WG-03 to Done and note the CLI review override in `state.json`.
- [ ] **Step 5:** Run `bun run fmt:check && bun run test`. Expected: PASS. Then commit `docs: config and state stores`.

---

## Scenario → test

**store-location**
- PI_CODING_AGENT_DIR moves the files → `tests/host-stores.test.ts` › `PI_CODING_AGENT_DIR moves the files`
- Default location → `tests/host-stores.test.ts` › `Default location`
- Stores read no environment → `tests/store/boundaries.test.ts` › `stores read no environment`
- Stores never import Pi → `tests/store/boundaries.test.ts` › `stores never import Pi`, plus `bun run lint`
- Created directory and file are owner-only → `tests/store/atomic.test.ts` › `created directory and file are owner-only`
- Existing config mode is kept → `tests/store/config-write.test.ts` › `existing config mode is kept`
- Read-only directory → `tests/store/state-file.test.ts` › `read-only directory`
- Failed write leaves the target unchanged → `tests/store/atomic.test.ts` › `failed write leaves the target unchanged`
- No temporary file after success → `tests/store/atomic.test.ts` › `no temporary file after success`

**config-file** (`tests/store/config-read.test.ts`, test names equal scenario names)
- Valid full example, Several problems reported together, Invalid result has no values, Bad JSON, Section of the wrong type, Top level is not an object, Value is not echoed, Unreadable file → same-named tests
- No file → `no file`
- Secret-like key, Typo, Unknown section, Prototype key → same-named tests
- Remote http URL rejected, Loopback http URL accepted, Other scheme rejected, URL with credentials rejected, Timeout bounds, Key-shaped apiKeyEnv rejected → same-named tests
- Tier without provider rejected, Unknown tier rejected, Model too long, Slot when bounds, Too many slots, Reserved slot name, Duplicate slot name, Slot without model → same-named tests
- Duplicate hold provider, Hold provider bounds, Non-boolean parentRequest, Enum values → same-named tests
- Read leaves the file untouched → same-named test
- Slot writer refuses an invalid file, Other keys kept, Invalid new slot refused, New crew key goes last, Last slot removed, Created from nothing → `tests/store/config-write.test.ts`, same-named tests

**state-file** (`tests/store/state-file.test.ts`, test names equal scenario names)
- Valid state read, Every documented feature accepted, Literal default rejected, Unknown feature, No file, Bad JSON, Partly valid file is not salvaged, Future version, Permission denied, Switch persists, Bad file moved aside, Invalid update refused, Reset clears everything → same-named tests

**settings-resolution** (`tests/store/settings.test.ts`, test names equal scenario names)
- Everything defaulted, Config over default, Tuning over config, Switch off, Mode from state, CLI review default from state, Config review without state, Non-integer tuning ignored, Out-of-range tuning ignored → same-named tests
