## Why

Tuning, replay and the operator's own review all depend on a record of real decisions, and the package has none yet. The earlier port's ledger lost the tier and the agent, and nothing prevented prompt text from landing in it. WG-07 and WG-11 are about to start writing decisions, so the record and its privacy guarantee must exist first.

## What Changes

- Add `src/store/ledger-schema.ts`: a strict, versioned (`v: 1`) schema for `main`, `worker` and `correction` lines. Every string is an enum or a short identifier with a pattern and a length limit, so free text is rejected.
- Add `src/store/ledger.ts`: append one validated line without a lock, rotate between `ledger.jsonl` and `ledger.1.jsonl` once the active file holds 2000 lines, and read the latest 2000 valid lines while skipping bad ones. Every operation returns its failure and never throws.
- Corrections become their own line kind that points at a main turn's `turnId`, instead of rewriting the earlier line's `corrected` field.

**Retention**
- From: "the latest 2000 kept"
- To: "at least the latest 2000 kept; at most about 4000 lines on disk, across two files"
- Reason: rotating whole segments is the only lock-free way to append that never loses a line to a parallel Pi process.
- Impact: non-breaking. This is a documentation change only, and nothing has written a ledger yet.

**Store write rule**
- From: every store write replaces its file atomically.
- To: whole-file stores (`config.json`, `state.json`) replace atomically. The ledger appends whole lines and rotates by rename.
- Reason: an append-only file cannot be written through a temp file and a rename.
- Impact: non-breaking for existing stores.

## Capabilities

### New Capabilities
- `decision-ledger`: ledger line schema, append, rotation and retention, tolerant reading, concurrency safety, owner-only files and failure handling.

### Modified Capabilities
- `store-location`: the atomic replacement requirement is narrowed to whole-file stores.

## Impact

- Code: new `src/store/ledger-schema.ts` and `src/store/ledger.ts`. Existing stores are unchanged. No writer is wired in this change; WG-07 and WG-11 call `appendLedger`.
- Dependencies: none added.
- Docs updated:
  - `docs/domain-model.md` (Ledger entry: `v`, `turnId`, the `correction` kind, the `outcome` and `reason` values, retention)
  - `docs/privacy.md` (two files, retention)
  - `docs/architecture.md` (store tree: `ledger-schema.ts`, `ledger.ts`)
  - `docs/configuration.md` (files table: `ledger.1.jsonl`, `ledger.rotate.lock`)
  - `docs/usage-guide.md` (deleting the ledger means both files)
  - `docs/roadmap.md` (WG-05 entry: "trim to 2000" becomes two-segment retention)
  - `docs/testing.md` (the ledger field-set test reads the exported field lists)
- Archive note: the `store-location` Purpose line ("replaced atomically") should say "whole-file stores are replaced atomically" when the spec is synced.
