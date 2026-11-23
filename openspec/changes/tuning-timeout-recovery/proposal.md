## Why

When classifier latency rises, `timeoutMs` tuning reacts only after 40 decisions, raises by small steps, and reverts raises that rescued answers because the overall timeout share kept rising. A revert then blocks the next raise for 200 decisions. On the local ledger this left `timeoutMs` at 1700 while latency climbed past it, and 30–40% of main turns showed `Jev · no answer`. Tuning should catch up within a few turns and come back down after recovery.

## What Changes

**Burst rule (new)**
- From: no change before 40 decisions follow the latest `timeoutMs` entry.
- To: 3 timeouts among the latest 5 asked decisions after the latest `timeoutMs` entry raise `timeoutMs` at once to `ceil100(current × 1.25)`, ignoring the cooldown and any block, and replacing a pending change.
- Reason: react while timeouts cluster, not after 40 or 200 turns.
- Impact: non-breaking; more frequent `applied` lines during latency spikes.

**New value of the window rule**
- From: `p90` over answered decisions only.
- To: `p90` over answered and timed-out decisions that carry `ms`, so a timed-out decision counts at the timeout in force.
- Reason: answered values are always below the timeout, which kept steps at +100 to +200 ms.
- Impact: non-breaking; larger steps when timeouts are frequent.

**Evaluating a pending raise**
- From: revert when the timeout share is worse than before.
- To: keep a raise when an answered decision after it took longer than its `from`; revert only without that evidence and with a worse share.
- Reason: rising upstream latency made helpful raises look worse.
- Impact: non-breaking; fewer reverts and blocks.

**Lowering (new)**
- From: tuning only raises `timeoutMs`.
- To: after 200 decisions with no timeout and a low `p90`, a tuned value is lowered one step toward its base, judged like a raise, and reverted when timeouts come back.
- Reason: a value raised during a spike must not stay high forever.
- Impact: non-breaking; a block can now hold back a lowering (for 400 decisions) as well as a raise, repeated undo walks back through a lowering, with matching undo, report and change line texts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tuning-rules`: adds the burst rule and lowering; changes the pure step, decision counting, new value, applying, cooldown, evaluation, block, supersede, undo and step order requirements.
- `tune-command`: undo message and block state line name the direction of the held-back change.
- `tuning-host`: change line text for a reverted lowering.

## Impact

- Code: `src/policy/tuning/rules.ts`, `src/policy/tuning/window.ts`, `src/policy/tuning/record.ts` (constants), `src/policy/tuning/text.ts`, `src/host/tuning/command.ts` (block direction in the view). No change to `tuning.json` format, config keys or the Jev request.
- Tests: `tests/policy/tuning/rules.test.ts`, `tests/policy/tuning/window.test.ts`, `tests/policy/tuning/text.test.ts`, `tests/host/tuning-host.test.ts`, tune command tests under `tests/host/commands/`.
- Docs: `docs/usage-guide.md` (Tuning section), `docs/decisions/0013-fast-timeout-tuning.md` (new, amends 0005), `docs/decisions/0005-bounded-auto-tuning.md` (amended-by link), `docs/decisions/README.md` (index), `docs/configuration.md` and `docs/glossary.md` where they state tuning limits.
