# Decision Ledger Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`decision-ledger`, `store-location`) and `design.md`.

**Goal:** Add `ledger.jsonl`: a strict, free-text-proof schema, lock-free appends, two-segment retention, tolerant reads, safe with several Pi processes.

**Architecture:** `src/store/ledger-schema.ts` is pure validation built on `src/store/validate.ts`. `src/store/ledger.ts` does the file I/O: append with `O_APPEND`, rotation guarded by `ledger.rotate.lock`, and reads across `ledger.1.jsonl` and `ledger.jsonl`. Nothing in `host/` calls it yet.

**Tech Stack:** TypeScript, Bun (`bun test`, `Bun.spawn` for multi-process tests), `node:fs` sync APIs.

## Global Constraints

- `src/store/` imports neither `@earendil-works/*` nor `process.env` (enforced by `tests/store/boundaries.test.ts` and lint).
- No new dependency.
- Issue messages never include the value found.
- Directory `0700`, files `0600`.
- Tests need no secrets, paid calls or network beyond loopback.
- Every public ledger function returns its outcome and never throws.

## Review Focus

1. **Non-ASCII in identifiers.** A string such as `agent: "wörker"` must be rejected by the patterns, not accepted. Test in Task 1.
2. **`__proto__` and `constructor` as keys** in `effortP`/`tierP`, or at the top level, must be rejected as unknown and must not pollute objects. Test in Task 1.
3. **A file that ends without a newline written by a crashed process, followed by a new append.** The next append starts on the same physical line, so the read must skip that merged line and keep the rest. Test in Task 3.
4. **An empty `ledger.jsonl` after a rotation** reads as zero lines, not one empty entry. Test in Task 3.
5. **Byte length versus character length for the 4096 limit.** Count bytes with `Buffer.byteLength`, never `.length`, both on append and on read. Tested in Task 1 by `size guard counts bytes` (a `model` of `a/é` is one byte longer than its character count).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `LedgerKind` | new | `"main" \| "worker" \| "correction"` | no (package-internal; WG-07/11 import it) |
| `MainEntry`, `WorkerEntry`, `CorrectionEntry`, `LedgerEntry` | new | TypeScript types mirroring the field table in `specs/decision-ledger/spec.md`; `LedgerEntry = MainEntry \| WorkerEntry \| CorrectionEntry`, each with `v: 1`, `kind` literal | no |
| `LEDGER_FIELDS` | new | `Readonly<Record<LedgerKind, readonly string[]>>`, the allowed keys per kind, including the common ones | no |
| `LEDGER_MAX_LINE_BYTES` | new | `4096` | no |
| `validateLedgerEntry` | new | `(value: unknown, opts?: { maxLineBytes?: number }) => { ok: true; entry: LedgerEntry; line: string } \| { ok: false; issues: Issue[] }`. `line` is the serialized JSON plus `\n`; `maxLineBytes` defaults to `LEDGER_MAX_LINE_BYTES` and exists only for tests | no |
| `appendLedger` | new | `(dir: string, entry: unknown, hooks?: LedgerHooks) => WriteResult` | no |
| `readLedger` | new | `(dir: string, hooks?: LedgerHooks) => LedgerRead` | no |
| `LedgerRead` | new | `{ kind: "ok"; entries: LedgerEntry[]; skipped: number } \| { kind: "unreadable"; issues: Issue[] }` | no |
| `LedgerHooks` | new | `{ beforeRotateLock?: () => void; whileRotateLocked?: () => void; betweenSegments?: () => void }`. Test seams only; production callers pass nothing | no |
| `ledger.jsonl`, `ledger.1.jsonl` | new | One JSON object per line, ending in `\n`, as in the spec's field table | yes (on-disk format the operator reads) |
| `ledger.rotate.lock` | new | Empty file, `0600`, existence means a rotation is in progress | no |
| `LEDGER_LINES`, `ROTATE_LOCK_STALE_MS` | new | `2000`, `60000` (exported constants in `ledger.ts`) | no |

---

## Task 1: Ledger schema — implements 1.1, 1.2, 1.3

**Files:**
- Create: `src/store/ledger-schema.ts`
- Test: `tests/store/ledger-schema.test.ts`

**Interfaces:**
- Consumes: `object`, `string`, `integer`, `oneOf`, `boolean`, `joinPath`, `Issue`, `V` from `src/store/validate.ts`; `MODES`, `TIERS` from `src/store/defaults.ts`.
- Produces: `LedgerKind`, `LedgerEntry` and its variants, `LEDGER_FIELDS`, `LEDGER_MAX_LINE_BYTES`, `validateLedgerEntry` (see Contracts).

- [ ] **Step 1: Write failing tests.** Use a helper `base(kind)` returning `{ v: 1, at: 1762400000000, kind, session: "s-1" }` plus the required fields for that kind. Tests, one per spec scenario, named after it:
  - `valid main line accepted`, `valid worker line accepted` (`tier: "slot::reviewer"`, `model: "anthropic/claude-sonnet-4-6"`, `reason: "slot"`, `status: "completed"`, `briefChars: 812`), `valid correction line accepted` (`corrects: 0.82`) → `ok: true`.
  - `unknown kind rejected` (`kind: "tool"`) → an issue path `kind`.
  - `field from another kind rejected` (correction with `agent`) → `{ path: "agent", message: "unknown key" }`.
  - `missing required field rejected` (main without `outcome`) → path `outcome`.
  - `exported field sets match the table`: `LEDGER_FIELDS.main`, `.worker` and `.correction`, sorted, equal literal arrays copied from the spec table (common + kind fields).
  - `unknown agent value is still an identifier` → ok.
  - `deciding worker without a tier rejected` (`reason: "choice"`) → path `tier`. `untouched worker without a tier accepted` → ok.
  - `miss with an answer rejected` (`answered: true, miss: "timeout"`) → path `miss`.
  - `long text field rejected` (300-character sentence as `agent`) → path `agent`, and `JSON.stringify(issues)` does not contain the sentence.
  - `prompt field rejected` → `{ path: "prompt", message: "unknown key" }`.
  - `probability out of range rejected` (`effortP: { high: 1.2 }`) → path `effortP.high`. `NaN probability rejected` (`risky: NaN`) → path `risky`.
  - `target distribution capped at 12`: `tierP` with 13 slot keys → an issue at `tierP`.
  - `slot target accepted` (`tierP: { balanced: 0.3, "slot::reviewer": 0.7 }`). `malformed target rejected` (`fallback: "slot::Code Reviewer"`) → path `fallback`.
  - `widest valid entry fits`: build a main entry and a worker entry with every allowed field at its longest value (64-character ids, 128-character model and caller model, 12 slot targets of 24 characters in `tierP`, every probability `0.1234567890123456`, every count `1000000000`, `at` `8640000000000000`) → both `ok: true` and `Buffer.byteLength(line) <= 4096`.
  - `size guard counts bytes`: a valid worker entry with `model: "a/é"`; call with `maxLineBytes` equal to its char length (`line.length`) → issue `{ path: "", message: "line exceeds the size limit" }`; with `Buffer.byteLength(line)` → ok.
  - `non-object entry rejected` for `null`, `"x"` and `[]` → path `""`.
  - Review Focus 1 and 2: `agent: "wörker"` → path `agent`; `effortP: { __proto__: 0.5 }` parsed from JSON text → path `effortP.__proto__`; `{"constructor": 1}` at the top level → `unknown key`.
- [ ] **Step 2:** `bun test tests/store/ledger-schema.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement `src/store/ledger-schema.ts`.** Add a local `probability(): V<number>` (finite, 0–1) and `record(keys: V<string>, value: V<number>, max: number): V<Record<string,number>>`. That helper uses `Object.keys` on the parsed object, builds the output with `Object.defineProperty` as `src/policy/answers.ts` does, and rejects own keys failing `keys`. Domain regexes are copied from the spec table. Pick the per-kind shape by `kind` first: an unknown kind gives one issue at `kind` and stops. Run `object(shape, { required })` from `validate.ts`, then the cross-field checks, which push `{ path: "tier" }` and `{ path: "miss" }` issues directly after `object()` succeeds, then `line = JSON.stringify(entry) + "\n"` and `Buffer.byteLength(line) > (opts?.maxLineBytes ?? LEDGER_MAX_LINE_BYTES)` → an issue at `""` reading `line exceeds the size limit`. Use the reason subset constant `DECIDING_REASONS = ["fable","risky","slot","expert-denied","fast-unsure","choice"]`.
- [ ] **Step 4:** `bun test tests/store/ledger-schema.test.ts` → PASS; `bun run typecheck && bun run lint` → exit 0.
- [ ] **Step 5: Commit** `feat(store): ledger line schema`.

---

## Task 2: Append and rotation — implements 2.1, 2.2, 2.3

**Files:**
- Create: `src/store/ledger.ts`
- Test: `tests/store/ledger.test.ts`

**Interfaces:**
- Consumes: `validateLedgerEntry`, `LedgerEntry` and `WorkerEntry` (Task 1); `WriteResult` from `validate.ts`.
- Produces: `appendLedger`, `LedgerHooks`, `LEDGER_LINES`, `ROTATE_LOCK_STALE_MS` (see Contracts). The test helper `entry(i: number): WorkerEntry` returns `{ v: 1, at: 1762400000000 + i, kind: "worker", session: "s-1", mode: "standard", answered: false, agent: "w", briefChars: i, reason: "untouched", status: "completed" }`, with `i` used as given (Task 2 starts at 0, Task 3 at 1), and lives in `tests/store/ledger-fixtures.ts`, and Tasks 3 and 4 reuse it.

- [ ] **Step 1: Write failing tests** (use `tempDir`; each test cleans up with `chmod` restore as `state-file.test.ts` does):
  - `lines accumulate in order`: 3 appends → 3 lines, `JSON.parse` of each equals `entry(i)`; `readdirSync(dir)` has no `.tmp`.
  - `first append creates the file`: `dir = join(root, "jev")`; modes `0o700`/`0o600`.
  - `long text field rejected` and `prompt field rejected` and `non-object entry rejected` via `appendLedger`: `ok: false`, the long-text case's `JSON.stringify(issues)` does not contain the sentence; `existsSync(join(dir, "ledger.jsonl"))` is false.
  - `rotation at 2000 lines`: 2000 appends → `ledger.1.jsonl` has 2000 lines; `ledger.jsonl` is absent or empty; no `ledger.rotate.lock`.
  - `oldest segment dropped`: 4500 appends → the line count of `ledger.1.jsonl` plus `ledger.jsonl` is 2500, and the `briefChars` values are 2000–4499.
  - `another process rotated first`: fill to 1999 lines. `hooks.beforeRotateLock` renames `ledger.jsonl` to `ledger.1.jsonl` and writes 3 lines to a new `ledger.jsonl`. Append → `ledger.1.jsonl` content is unchanged by the writer (byte-compare with a snapshot taken inside the hook after the rename).
  - `held lock skips rotation`: create a fresh lock, fill to 2000 → no rename, the lock still exists.
  - `stale lock cleared`: create the lock with `utimesSync` set 61 s in the past; the append at 2000 → ok, the lock is gone, `ledger.1.jsonl` is absent; the next append rotates.
  - `failed rotation keeps the append`: `mkdirSync(join(dir,"ledger.1.jsonl"))` with a file inside; the append at 2000 → ok, the line is in `ledger.jsonl`, no lock.
  - `read-only directory` (skip if root): `chmod 0o500` → `{ ok: false, issues: [{ path: "", message: /EACCES/ }] }`.
  - `directory cannot be created`: `dir` is an existing regular file → `ok: false`, path `""`, message names a code (`ENOTDIR` or `EEXIST`).
  - `rotated segment keeps owner-only mode`: 2001 appends (one after the rotation) → `ledger.1.jsonl` and `ledger.jsonl` are both `0o600`.
  - `lock is owner-only`: fill to 1999; `hooks.whileRotateLocked` records `statSync(lock).mode & 0o777`; the append at 2000 → the recorded mode is `0o600`.
- [ ] **Step 2:** `bun test tests/store/ledger.test.ts` → FAIL.
- [ ] **Step 3: Implement `appendLedger`.** Validate; on failure return `{ ok: false, issues }`. `mkdirSync(dir, { recursive: true, mode: 0o700 })`; `openSync(path, "a", 0o600)`; one `writeSync(fd, buf)`; if the bytes written are fewer than `buf.length`, return an issue `cannot append ledger (EIO)`. Close in `finally`. Errors map to `{ path: "", message: \`cannot append ledger (${code})\` }`, matching the wording style in `state-file.ts`. Then call `maybeRotate(dir, hooks)` inside its own try/catch that ignores errors.
- [ ] **Step 4: Implement `maybeRotate`.** If `statSync(active).size < LEDGER_LINES * 64`, return. Count `\n` bytes; if below 2000, return. Call `hooks?.beforeRotateLock?.()`. Then `openSync(lock, "wx", 0o600)`: on `EEXIST`, stat the lock; if `Date.now() - mtimeMs > ROTATE_LOCK_STALE_MS`, `renameSync(lock, \`${lock}.${pid}.${random}.stale\`)` then `rmSync` it; return either way. Holding the lock: call `hooks?.whileRotateLocked?.()`, recount, and if 2000 or more, `renameSync(active, old)`. Always `rmSync(lock)` in `finally`.
- [ ] **Step 5:** `bun test tests/store/ledger.test.ts` → PASS; typecheck and lint → exit 0.
- [ ] **Step 6: Commit** `feat(store): ledger append with two-segment rotation`.

---

## Task 3: Read — implements 3.1, 3.2

**Files:**
- Modify: `src/store/ledger.ts`
- Test: `tests/store/ledger.test.ts`

**Interfaces:**
- Consumes: `validateLedgerEntry`, `LEDGER_MAX_LINE_BYTES`, `LedgerHooks`, `tests/store/ledger-fixtures.ts`.
- Produces: `readLedger`, `LedgerRead`.

- [ ] **Step 1: Write failing tests:**
  - `bad lines skipped`: write the lines `entry(1)`, `{"v":1,"kind":`, `{...entry(2), v: 2}` and `entry(3)`, each with `\n` → entries `[1, 3]`, `skipped: 2`.
  - `torn last line skipped`: write `entry(1)\n` followed by `entry(2)` with no newline → `[1]`, `skipped: 1`.
  - `both segments read in order`: `ledger.1.jsonl` = 1..2000, `ledger.jsonl` = 2001..2300 → `briefChars` 301..2300, `skipped: 0`.
  - `rotation during read`: old = 1..2000, active = 2001..2100. `hooks.betweenSegments` (fires once) renames the active file over the old one and writes 2101..2105 as a new active file → the result has no duplicate `briefChars`, is strictly increasing, and ends with 2105.
  - `no ledger` → `{ kind: "ok", entries: [], skipped: 0 }`.
  - `unreadable ledger`: `mkdirSync(join(dir,"ledger.jsonl"))` → `kind: "unreadable"`, message names `EISDIR`.
  - Review Focus 3: `entry(1)` written with no newline, then `appendLedger(entry(2))` → the read returns `[]` with `skipped: 1`; a following `appendLedger(entry(3))` → `[3]`.
  - `oversized line rejected`: write a line of a valid entry padded with spaces before the closing brace to 4100 bytes, then `entry(2)` → `[2]`, `skipped: 1`.
  - `oversized multibyte line skipped`: a stored line under 4096 characters but over 4096 bytes (a valid entry with `model: "a/" + "é".repeat(2100)`, written raw) → skipped and counted.
  - `blank line skipped`: `entry(1)\n\nentry(2)\n` → `[1, 2]`, `skipped: 1`.
  - Review Focus 4: an empty `ledger.jsonl` next to an old segment of 2000 → 2000 entries, `skipped: 0`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement `readLedger(dir, hooks?)`.** Before reading, `statSync(old).ino` (or `undefined` if missing). Read the old segment, call `hooks?.betweenSegments?.()`, read the active one. If the old segment's inode now differs, repeat once without hooks. Parse: split on `\n`; the last element is complete only if the text ends with `\n`; empty strings in the middle count as skipped, and a final empty string does not. Each candidate goes through `JSON.parse` in try/catch, skip any raw line whose `Buffer.byteLength` + 1 exceeds `LEDGER_MAX_LINE_BYTES` (the raw line, since re-serializing would drop padding), then `validateLedgerEntry`. Return `entries.slice(-LEDGER_LINES)`. `ENOENT` → empty; any other code → `unreadable` with `cannot read ledger (${code})`.
- [ ] **Step 4:** Run → PASS; typecheck and lint → exit 0.
- [ ] **Step 5: Commit** `feat(store): tolerant ledger read`.

---

## Task 4: Concurrent writers — implements 4.1, 4.2

**Files:**
- Create: `tests/fixtures/ledger/writer.ts`
- Test: `tests/store/ledger-concurrency.test.ts`

**Interfaces:**
- Consumes: `appendLedger`, `readLedger`.
- Produces: a writer CLI `bun tests/fixtures/ledger/writer.ts <dir> <writerId> <count>` that appends `count` main entries `{ v: 1, at: Date.now(), kind: "main", session: "w<writerId>", mode: "standard", answered: false, turnId: "<writerId>-<seq>", outcome: "ok" }` with `seq` from 0, creates `<dir>/ready-<writerId>` once its imports have loaded, then waits on a start barrier (polls for `<dir>/go` every 1 ms, up to 10 s), and exits non-zero if any append returns `ok: false`.

- [ ] **Step 1: Write the writer script and failing tests.**
  - `parallel processes, no rotation`: spawn 8 writers × 200 with `Bun.spawn([process.execPath, script, …])`, wait until all 8 `ready-*` files exist (poll, up to 10 s), then create `go`, await all exits as 0. Concatenate the raw lines of `ledger.1.jsonl` (if present) and `ledger.jsonl`: 1600 lines, every line passes `validateLedgerEntry`, the `turnId` set has 1600 unique values, and for each writer the sequence numbers appear in increasing order.
  - `parallel processes across a rotation`: pre-fill `ledger.jsonl` with 1990 lines of `turnId: "pre-<i>"` (write directly), then do the same spawn. Assert `ledger.1.jsonl` has at least 2000 lines, `ledger.jsonl` fewer than 2000, a total of 3590 valid lines, 3590 unique `turnId` values, and per-writer order across `old + active`.
  - Set test timeouts to 30 s. The writer script lives under `tests/fixtures/` so the boundary lint rules for `src/` do not apply.
- [ ] **Step 2:** `bun test tests/store/ledger-concurrency.test.ts` → it passes if Tasks 2–3 are right. If it fails, debug before continuing. Sanity check that the test can fail: temporarily open the ledger with `"w"` instead of `"a"` in `appendLedger`, confirm the test fails, then revert. Run it 5 times in a loop (`for i in 1 2 3 4 5; do bun test tests/store/ledger-concurrency.test.ts || break; done`) → all pass.
- [ ] **Step 3: Commit** `test(store): concurrent ledger writers lose no line`.

---

## Task 5: Docs and full check — implements 5.1, 5.2

**Files:**
- Modify: `docs/domain-model.md`, `docs/privacy.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/roadmap.md`, `docs/testing.md`

- [ ] **Step 1: Edit the docs**:
  - `docs/domain-model.md` Ledger entry (lines 215–248): add `v`, `turnId` and the `correction` kind. Replace `corrected` with "a `correction` line pointing at the turn's `turnId`". Add the `outcome`, `reason` and `status` values. Change the `risky` row's meaning from "Noul" to "Probability" (the glossary term Noul stays). Retention becomes "at least the latest 2000 kept, in two files". Also update the Rules bullet on `corrected`, the Correction mark row (line 124: "≥ .7 writes a correction line for the previous turn") and line 272 ("Main turns with a correction line").
  - `docs/privacy.md`: "`ledger.jsonl` and `ledger.1.jsonl`, owner-readable only, at least the latest 2000 lines (at most about 4000)". Deleting means both files.
  - `docs/architecture.md` store tree: `ledger-schema.ts  Ledger line schema and field lists`; `ledger.ts  ledger.jsonl: append, rotate, read`.
  - `docs/configuration.md` Files table: add `ledger.1.jsonl` (the previous segment) and `ledger.rotate.lock` (present only during a rotation). Add a note that the ledger appends lines instead of replacing the file.
  - `docs/usage-guide.md` line 209: unchanged, since deleting `~/.pi/agent/jev/` removes both files. Recorded here so the docs list in the proposal is accounted for.
  - `docs/roadmap.md` WG-05: "trim to 2000" becomes "keep at least the latest 2000 in two rotating files".
  - `docs/testing.md` Privacy: the field-set test reads `LEDGER_FIELDS`.
- [ ] **Step 2:** `bun run typecheck && bun run lint && bun run fmt:check && bun run test` → all exit 0. Run `bun run fmt` first if `fmt:check` fails on new files.
- [ ] **Step 3: Commit** `docs: describe the decision ledger`.

---

## Scenario → test

- NaN probability rejected → `ledger-schema.test.ts` › `NaN probability rejected`
- Target distribution capped at 12 → `ledger-schema.test.ts` › `target distribution capped at 12`
- Blank line skipped → `ledger.test.ts` › `blank line skipped`
- Slot target accepted → `ledger-schema.test.ts` › `slot target accepted`
- Malformed target rejected → `ledger-schema.test.ts` › `malformed target rejected`
- Valid main line accepted → `ledger-schema.test.ts` › `valid main line accepted`
- Valid worker line accepted → `ledger-schema.test.ts` › `valid worker line accepted`
- Valid correction line accepted → `ledger-schema.test.ts` › `valid correction line accepted`
- Unknown kind rejected → `ledger-schema.test.ts` › `unknown kind rejected`
- Field from another kind rejected → `ledger-schema.test.ts` › `field from another kind rejected`
- Missing required field rejected → `ledger-schema.test.ts` › `missing required field rejected`
- Exported field sets match the table → `ledger-schema.test.ts` › `exported field sets match the table`
- Unknown agent value is still an identifier → `ledger-schema.test.ts` › same name
- Deciding worker without a tier rejected → `ledger-schema.test.ts` › same name
- Untouched worker without a tier accepted → `ledger-schema.test.ts` › same name
- Miss with an answer rejected → `ledger-schema.test.ts` › same name
- Long text field rejected → `ledger-schema.test.ts` and `ledger.test.ts` › `long text field rejected`
- Prompt field rejected → `ledger-schema.test.ts` and `ledger.test.ts` › `prompt field rejected`
- Probability out of range rejected → `ledger-schema.test.ts` › same name
- Widest valid entry fits → `ledger-schema.test.ts` › `widest valid entry fits` (plus `size guard counts bytes`)
- Oversized line rejected → `ledger.test.ts` › `oversized line rejected` and `oversized multibyte line skipped` (read)
- Non-object entry rejected → `ledger-schema.test.ts` and `ledger.test.ts` › `non-object entry rejected`
- Lines accumulate in order → `ledger.test.ts` › same name
- First append creates the file → `ledger.test.ts` › same name
- Rotation at 2000 lines → `ledger.test.ts` › same name
- Oldest segment dropped → `ledger.test.ts` › same name
- Failed rotation keeps the append → `ledger.test.ts` › same name
- Another process rotated first → `ledger.test.ts` › same name
- Held lock skips rotation → `ledger.test.ts` › same name
- Stale lock cleared → `ledger.test.ts` › same name
- Parallel processes, no rotation → `ledger-concurrency.test.ts` › same name
- Parallel processes across a rotation → `ledger-concurrency.test.ts` › same name
- Bad lines skipped → `ledger.test.ts` › same name
- Torn last line skipped → `ledger.test.ts` › same name
- Both segments read in order → `ledger.test.ts` › same name
- Rotation during read → `ledger.test.ts` › same name
- No ledger → `ledger.test.ts` › same name
- Unreadable ledger → `ledger.test.ts` › same name
- Read-only directory → `ledger.test.ts` › same name
- Directory cannot be created → `ledger.test.ts` › same name
- Rotated segment keeps owner-only mode → `ledger.test.ts` › same name
- Lock is owner-only → `ledger.test.ts` › same name
- store-location: Failed write leaves the target unchanged → existing `tests/store/atomic.test.ts` (unchanged)
- store-location: No temporary file after success → existing `tests/store/atomic.test.ts` (unchanged)
