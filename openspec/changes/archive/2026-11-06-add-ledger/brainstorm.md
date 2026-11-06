## Design Summary

WG-05 adds the decision ledger: a local file, `<agentDir>/jev/ledger.jsonl`, with one line per main-session or worker decision and its outcome. It serves two readers: the operator, who inspects real use after the fact, and later work groups (WG-16 replay, WG-18 tuning), which replay thresholds from the stored probabilities. WG-07 and WG-11 are the first writers.

Why it matters: the earlier port's ledger dropped the tier and wrote `agent: unknown`, so its tier decisions could only be inferred. Its readers also had to trust that no prompt text leaked into it. This ledger must record every decision field the docs list and must be unable to hold free text.

**Goals**

- A strict schema covering the common, main and worker fields of `docs/domain-model.md#ledger-entry`, versioned with `v: 1`. Every string is an enum or a short identifier with a pattern and a length limit, so a long free-text value is rejected before it reaches the disk.
- Append one line per decision from several Pi processes at once, without losing a line.
- Keep at least the latest 2000 lines. Older lines are dropped.
- Reading tolerates bad lines: a truncated, invalid or unknown-version line is skipped and counted. It never hides the good lines around it.
- Owner-only permissions: directory `0700`, files `0600`.
- A failed write never throws and never blocks a turn. The decision still applies (`docs/architecture.md`: "Ledger write fails: decision still applied").

**Non-goals**

- No writers in this group. Hooking `before_agent_start`, turn end and worker completion belongs to WG-07 and WG-11.
- No `/jev report` (G2, not selected), no tuning reads, no replay script.
- No import of the port's `jev-pilot/` ledger.

**Anti-goals** (failure even if it works)

- Any prompt text, brief, tool argument or tool output in the file.
- A line silently lost because two Pi processes wrote or trimmed at the same time.
- A slow or locked disk delaying a turn.

**Constraints**

- `src/store/` imports neither Pi nor `process.env`; the host passes the jev directory as a plain path.
- The current `store-location` spec says every store write is a temp file plus a rename. An append-only file cannot follow that rule, so the change must narrow it to whole-file stores and give the ledger its own durability rule.

## Alternatives Considered

### Alternative A: Lockfile around every append and trim
- **Approach**: Each append and each trim takes `ledger.lock` (created exclusively, removed when stale). Trim rewrites the file to its latest 2000 lines.
- **Pros**: The file holds exactly 2000 lines after a trim. One file.
- **Cons**: Every decision waits on a lock. A crashed process leaves a stale lock, and the stale-lock heuristics are racy. When the lock is busy, the line is dropped.
- **Why not chosen**: It puts a lock on the hot path and drops lines exactly when there is contention, which defeats the "no line lost" goal.

### Alternative B: Lock-free append, locked trim with re-read
- **Approach**: Appends use `O_APPEND` without a lock. Only trim takes a lock, re-reads the tail and renames a rewritten file.
- **Pros**: Fast appends; one file near 2000 lines.
- **Cons**: An append that lands between the trim's re-read and its rename is lost. Closing that gap needs appenders to honour the lock again.
- **Why not chosen**: It cannot be proven lossless without bringing the lock back to appends.

### Alternative C: Two rotating segments
- **Approach**: Appends go to `ledger.jsonl` without a lock. Once it holds more than 2000 lines, it is renamed to `ledger.1.jsonl`, replacing the older segment. Reads return the latest 2000 valid lines across both files.
- **Pros**: No lock on the hot path. An append that races a rotation still lands in the renamed segment, so it is kept. No rewriting of existing lines.
- **Cons**: Between 2000 and about 4000 lines are kept on disk, not exactly 2000. Two processes rotating at the same moment must not replace a segment that was just rotated.
- **Why not chosen**: Chosen.

## Agreed Approach

Alternative C, chosen by the operator during explore. Its only cost is that "the latest 2000 kept" becomes "at least the latest 2000 kept, at most about 4000 on disk", and `docs/privacy.md` and `docs/domain-model.md` are updated to say so.

## Key Decisions

- **Two segments, lock-free append.** Operator's choice. Reads return the latest 2000 valid lines.
- **One line per decision, written when its outcome is known.** Operator's choice. The writer keeps the entry in memory and appends a single line at turn end (main) or worker completion. If Pi crashes mid-turn, that turn's line is lost. This is accepted because the ledger is a signal, not a record of truth.
- **`corrected` is its own line.** Operator's choice. When the next prompt reads as a correction (`corrects ≥ .7`), a `kind: "correction"` line is appended, pointing at the previous main turn's `turnId`. Readers join the two. Main lines therefore gain a `turnId`, and `domain-model.md` gains the correction line kind.
- **Full strict schema now.** Operator's choice. All fields from `domain-model.md` are defined in WG-05 with `v: 1`, and unknown fields are rejected. Later groups that need a new field change this spec through their own delta.
- **Rotation is guarded, appends are not** (my call, to be detailed in design). Lock-free appends are kept as agreed. The rare rotation step itself must not let two processes each rotate and replace a just-rotated segment, since that would lose up to 2000 lines. If the guard is busy, rotation is simply retried on a later append.
- **Validation rejects, never truncates** (my call). An entry that fails the schema is not written, and the writer gets the problems back. Values are never shortened to fit.

## Open Questions

- Exact length limits for identifiers such as `model`, `agent`, `skill` and `session` are left to design, guided by the identifiers Pi and the executor actually produce.
