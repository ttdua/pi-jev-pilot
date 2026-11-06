## Context

`src/store/` holds `config.json` and `state.json`. Both are whole files replaced through `writeFileAtomic` (a temp file, fsync, then rename). `validate.ts` provides small validators that collect issues by field path and never echo values. The host passes `<agentDir>/jev` as a plain path, and stores read no environment and import no Pi.

The ledger differs in three ways: it is append-only, several Pi processes write it at once (parent sessions in different terminals, while in-process children share the parent's process), and it is written on paths that must never delay or break a turn. The brainstorm fixed the approach: two rotating segments, appends without a lock, one line per decision written once its outcome is known, a separate correction line, and a full strict schema.

## Goals / Non-Goals

**Goals:**
- A schema in which every value is a number, a boolean, an enum or a short identifier, so no field can hold prompt text.
- No line lost to concurrency, including across a rotation.
- Reads that survive torn, foreign or future-version lines.

**Non-Goals:**
- Calling the ledger from `host/` (WG-07, WG-11).
- Fsync per line. The ledger is a signal; a line lost to a power cut is acceptable.
- Reading or merging the port's ledger.

## Decisions

### D1. Two modules: `ledger-schema.ts` and `ledger.ts`
The schema (types, validators, field lists) is pure and lives apart from file I/O, so the privacy test and later readers such as replay and tuning can import the field lists without touching the disk. Both stay in `store/`, which keeps the dependency rules unchanged. A `policy/` home was rejected because `policy/` must not import `store/`, and the validators live in `store/validate.ts`.

### D2. Line kinds and fields
Three kinds share `v: 1`, `at`, `kind` and `session`:

- `main`: one per eligible main prompt that reached a decision or a miss, written at turn end. It carries `turnId` so a later correction can point at it.
- `worker`: one per routed `subagent` launch, written on `subagents:completed` or `subagents:failed`.
- `correction`: written when a prompt's `corrects ≥ .7`, holding the previous main turn's `turnId` and the `corrects` value.

The field `corrected` from `docs/domain-model.md` is replaced by the `correction` kind, since a written line is never edited. `corrects` stays on the main line as that prompt's own read.

The full field table and value domains live in `specs/decision-ledger/spec.md`. The reasoning behind the choices that are not obvious:

- **Identifiers have patterns and lengths, never free strings.** `callerModel` is looser than `model` (it allows `:` and a bare id or alias) because callers name models loosely, but it still allows no spaces and at most 128 characters.
- **`reason` follows the WorkerDecision order.** `fable`, `risky`, `slot`, `expert-denied`, `fast-unsure` and `choice` decide. `untouched` (resume, `inherit_context`, switched off, no tier configured) and `miss` do not. `tier` is required exactly when `reason` decides, which makes "tier and agent must always be recorded" checkable.
- **`status` uses the executor's terminal statuses** (`completed`, `aborted`, `stopped`, `error`, from `SubagentStatus` in `@gotgenes/pi-subagents`), so WG-11 can copy them without mapping.
- **`miss` implies `answered: false`**, so readers never see a contradictory pair.
- **`at` is bounded by the largest valid JavaScript date** (8.64e15). Other numbers use a count domain capped at 1e9.

A serialized line longer than 4096 bytes is rejected. Unknown keys, wrong types, out-of-range numbers and non-matching strings are rejected with an issue at the field path, without the value, as `validate.ts` already does. Values are never truncated.

### D3. Append: one `write()` with `O_APPEND`, no lock
`appendLedger(dir, entry)` validates, serializes to one line ending in `\n`, ensures the directory (`0700`), opens `ledger.jsonl` with `O_APPEND | O_CREAT` and mode `0600`, writes the line in one `writeSync`, and checks that the full length was written. On local filesystems on macOS and Linux, an `O_APPEND` write of a few KB lands whole at the end of the file, so lines from several processes do not interleave. The 4096-byte cap keeps lines in that range. Network filesystems are out of scope and are noted as a risk.

Rejected: a lock per append (it waits on the hot path and drops lines under contention).

### D4. Rotation: guarded rename of the active segment
After a successful append, the writer checks the active file's size. Only when the size could hold 2000 lines (2000 × 64 bytes, below the shortest valid line) does it count newlines. At 2000 or more lines it tries to rotate:

1. Create `ledger.rotate.lock` with `wx` and mode `0600`. If it exists and is younger than 60 s, skip; a later append retries. If it is older, clear it by renaming it to a unique name and then removing that name, and skip. Renaming means only one process can claim a given stale lock, although a fresh lock created by another process in between can still be renamed away (see Risks).
2. Under the lock, count the active file's lines again. Another process may have just rotated it.
3. If there are still 2000 or more, rename `ledger.jsonl` over `ledger.1.jsonl`.
4. Remove the lock.

A process that opened `ledger.jsonl` before the rename keeps writing to the same inode, now `ledger.1.jsonl`, so its line is kept. Re-counting under the lock prevents a second rotation from replacing a segment that was just rotated. Rotation failures never fail the append; the append result reflects only the line.

Retention follows: the old segment holds 2000 or more lines and the active one holds the newest. Reads therefore always have at least the latest 2000 lines, once that many were written, and the disk holds at most about 4000 plus the few lines written during a rotation.

Rejected: unique-name segments with pruning. They are lock-free, but they would change the agreed two-file layout and need prune rules.

### D5. Read: newest 2000 valid lines, tolerant
`readLedger(dir)` reads `ledger.1.jsonl` then `ledger.jsonl`, splits on `\n` and parses each line. An empty line in the middle, a line that is not JSON, fails the schema, or has `v` other than 1 is skipped and counted in `skipped`, while the lines around it still count. A missing final newline (a torn last line) is treated the same way. The result is the last 2000 valid lines in file order. If the old segment's inode changes between the start and the end of the read (a rotation happened), the read runs once more. Missing files are empty. Any other read error returns `unreadable` with the error code, and never throws.

### D6. Results, not throws
Append returns `WriteResult` (from `validate.ts`): schema problems as field issues, and I/O failures as one issue at `""` naming the code. The host (WG-07/11) logs it verbosely and applies the decision anyway. This matches the existing `store-location` failure rule.

### D7. `store-location` narrowed
"Atomic replacement" becomes a rule for whole-file stores. The ledger's rules (append whole lines, rotate by rename, owner-only) live in `decision-ledger`. Owner-only modes and returned write failures stay global.

## Risks / Trade-offs

- [O_APPEND atomicity is not promised by POSIX for regular files] → The cap of 4096 bytes keeps lines small, and the concurrency test runs several real processes on the CI filesystem. Readers skip any line that is torn anyway.
- [A process frozen for more than 60 s while holding the rotation lock could rotate twice] → Rotation takes microseconds and is re-checked under the lock. The worst case is losing one old segment, which is a signal loss, not a privacy issue. Documented.
- [Two processes clearing the same stale lock: A sees it stale, B clears it and takes a fresh lock, then A renames B's fresh lock away] → This needs a lock to be stale first, which only happens after a crash during rotation, and then a race within microseconds. The line-count recheck under the lock still stops a second rename unless both re-count before either renames. The worst case is one lost old segment: signal loss, not a privacy issue.
- [Counting newlines reads up to about 2 MB after the size threshold] → This happens only once the active file nears 2000 lines. It is a sequential read, and appends are at most a few per turn.
- [Retention of up to about 4000 lines on disk instead of 2000] → Accepted by the operator. The docs state it.
- [Network filesystems] → Out of scope. The agent directory is local in supported setups.

## Migration Plan

None. No ledger file exists yet, and the port's files are in another directory. Rollback is a revert. An existing `ledger.jsonl` from a revert-and-reapply simply keeps being read.

## Open Questions

None blocking. The exact `outcome` set for main turns (`ok`, `error`, `aborted`) may grow in WG-07 through a delta, if Pi's turn end exposes more.
