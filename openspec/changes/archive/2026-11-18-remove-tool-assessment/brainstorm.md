## Design Summary

Remove Jev tool assessment entirely. A worker's tools are decided by its agent definition alone: the declared `tools` (or the executor's defaults) minus `disallowed_tools`, plus the executor's own `ask_parent` and `notify_parent`. A child that needs something it does not have asks its parent instead of being granted it by a classifier.

**Why.** Assessment makes a child's tool set non-deterministic, and its grant path can widen a child past what the agent author declared (any parent tool can be granted, including an extension tool that writes files to a read-only agent). A `disallowed_tools` denylist cannot close that gap. Tool access belongs to the agent author; Jev keeps deciding model and effort only.

**Goals**
- No Jev request asks `tool::` or `grant::` questions; the launch policy never returns `addTools` or `removeTools`.
- Existing user files keep working: a `config.json` with a `tools` section stays valid, a `state.json` with `switches.tools` stays valid, old ledger lines with `tools*` counts still read.

**Non-goals**
- Changing the executor's launch-policy seam (`addTools` / `removeTools`, `grantedTools` on `subagents:child:bound`) in `packages/pi-subagents`. It stays as a generic seam; jev-pilot stops using it.
- The built-in agent roster (separate change `builtin-role-agents`).
- Changing worker routing, model or effort decisions, or the worker rubric version.

**Anti-goals**
- A leftover `tools` key in `config.json` must never make the config invalid, since an invalid config turns the whole package off.
- No per-session toast or nag for the deprecated key.

Living specs touched (the change alters these specified requirements explicitly):
- `tool-assessment`: every requirement is removed.
- `config-file`: the `tools.mode` / `tools.grantAt` validation rules and their scenarios change to "accepted and ignored".
- `settings-resolution`: the resolved settings no longer have `tools`; the `tools.grantAt` scenario goes.
- `worker-ledger` and `decision-ledger`: `toolsScored`, `toolsFlagged`, `toolsGranted` are no longer written; old lines with them still read.
- `worker-routing`: "Doing nothing MUST mean returning no adjustment, unless tool assessment returns one" loses its exception.
- `jev-command`: the status lists seven feature switches, not eight; `tools` is no longer a feature for `/jev <feature> on|off`; the no-executor and duplicate-executor wording drops "and tool assessment"; status reports the deprecated config key.
- `readiness-checks`, `worker-modes`, `tuning-host`, `release-metadata`: references to tool assessment are dropped.
- `state-file`: `switches.tools` is retired like `switches.review`.

## Alternatives Considered

### Alternative A: Remove the capability, keep a compatibility path
- **Approach**: Delete the assessment code, questions, settings and switch. Accept and ignore the old `tools` config section and `switches.tools`; keep reading old ledger lines.
- **Pros**: Tool access is fully deterministic; no dead code; follows the precedent of the retired `review` switch.
- **Cons**: Touches many specs, tests and docs at once.
- **Why not chosen**: Chosen.

### Alternative B: Turn the `tools` switch off by default
- **Approach**: Keep all code; default `switches.tools` to off.
- **Pros**: Smallest diff; reversible by the user.
- **Cons**: Grant path still exists for anyone who turns it on; dead code stays to maintain.
- **Why not chosen**: Contradicts the goal that subagents never get tools from Jev.

### Alternative C: Remove the capability and reject old keys
- **Approach**: Same as A, but `tools` in `config.json` becomes an unknown key.
- **Pros**: Strict, no compatibility code.
- **Cons**: An old config becomes invalid, which turns off every Jev feature for that user.
- **Why not chosen**: The user ruled out breaking existing configs.

## Agreed Approach

Alternative A. It removes the grant path and the classifier from tool access, and keeps every existing user file working, at the cost of a wide but mechanical diff.

## Key Decisions

- The `tools` section of `config.json` (any of `mode`, `grantAt`) is accepted and ignored; `/jev` status shows one line saying the key is deprecated and ignored. No toast.
- `switches.tools` in `state.json` is accepted and dropped, the same way `switches.review` was retired.
- `/jev tools on|off` is answered as an unknown feature, like any other unknown name (user choice 1).
- New `worker` ledger lines carry no `toolsScored`, `toolsFlagged` or `toolsGranted`; existing lines that carry them stay valid.
- The executor seam in `packages/pi-subagents` is not changed; no `VENDORED.md` entry.
- Worker rubric version stays unchanged.

## Open Questions

- None blocking. The exact wording of the deprecation line in `/jev` status is left to design.
