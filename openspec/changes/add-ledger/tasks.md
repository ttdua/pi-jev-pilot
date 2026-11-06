## 1. Schema

- [x] 1.1 Add `src/store/ledger-schema.ts` with the value-domain validators (id, agent, skill, model, caller model, target, level, mode, probability, count, time, distributions) built on `src/store/validate.ts`
- [x] 1.2 Add the per-kind field tables (`main`, `worker`, `correction`), the exported field-name sets, and `validateLedgerEntry` with the cross-field rules (deciding `reason` requires `tier`; `miss` requires `answered: false`) and the 4096-byte line limit
- [x] 1.3 Unit tests in `tests/store/ledger-schema.test.ts` for every schema, domain and free-text scenario, including the exported field-set test

## 2. Append and rotation

- [x] 2.1 Add `appendLedger(dir, entry)` in `src/store/ledger.ts`: validate, serialize, ensure the `0700` directory, open with `O_APPEND`/`O_CREAT`/`0600`, single write, short-write check, return a `WriteResult` and never throw
- [x] 2.2 Add rotation after an append: a size gate, then a line count, then `ledger.rotate.lock` (exclusive, `0600`, 60 s staleness, stale lock cleared by a unique rename), a recount under the lock, a rename over `ledger.1.jsonl`, and lock removal; failures never fail the append
- [x] 2.3 Tests in `tests/store/ledger.test.ts` for append, retention, rotator lock, failures and modes

## 3. Read

- [x] 3.1 Add `readLedger(dir)`: read both segments in order, skip and count invalid or torn lines, return the latest 2000, repeat once on a rotation during the read, treat missing files as empty, and return `unreadable` with the code otherwise
- [x] 3.2 Tests for tolerant and consistent reads in `tests/store/ledger.test.ts`

## 4. Concurrency

- [ ] 4.1 Add a writer script `tests/fixtures/ledger/writer.ts` that appends N distinct entries tagged with a writer id and sequence number
- [ ] 4.2 Multi-process tests in `tests/store/ledger-concurrency.test.ts`: 8 processes × 200 entries into an empty ledger, and across a rotation from 1990 lines; assert no loss, no duplicates, per-process order and no invalid line

## 5. Docs

- [ ] 5.1 Update `docs/domain-model.md` (Ledger entry: `v`, `turnId`, `correction` kind replacing `corrected`, `outcome`/`reason`/`status` values, `risky` typo, retention), `docs/privacy.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/roadmap.md` and `docs/testing.md`
- [ ] 5.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`; all pass
