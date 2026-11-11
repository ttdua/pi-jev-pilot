# 0009: Vendor the executor and add seams

**Status:** Accepted, 2026-11-11. Supersedes [0006](0006-gotgenes-executor.md).

## Context

[ADR 0006](0006-gotgenes-executor.md) used `@gotgenes/pi-subagents` through its public surface. That left worker routing and tool assessment resting on guesses: launches joined to children by `outputFile` and to outcomes by `details.agentId`, agent files parsed twice, `spawn()` launches never routed, and tools that could only be removed. Upstream rations provider seams and keeps tool policy in another package, so these contracts will not come from upstream.

## Decision

Vendor the executor into `packages/pi-subagents/` with `git subtree --squash`, from tag `pi-subagents-v25.0.5`, and add the seams there:

- launch identity on lifecycle events, and effective model and thinking per launch;
- an agent registry query;
- one launch policy provider, consulted for every launch, with checked tool grants;
- `disallowed_tools` in agent frontmatter.

The workspace is private (`@ttdua/pi-subagents`) but keeps the executor's service key, event names and `subagent` tool name. One `pi install` loads both extensions, executor first. `packages/pi-subagents/VENDORED.md` records the upstream tag and every local change.

## Consequences

- **Maintenance.** Upstream syncs are manual: split at a release tag, then `git subtree pull --squash`. New seams live in new files so conflicts stay small.
- **Users uninstall the original.** Pi refuses to start when two extensions register the `subagent` tool, so `@gotgenes/pi-subagents` must be removed first. `@gotgenes/pi-subagents-worktrees` keeps working: the vendored service is published at load.
- **Duplicate detection has a limit.** `/jev` reports `duplicate executor` only when jev-pilot's extension runs with the original executor but without the vendored one. Pi keeps only the first registration of a name and does not show extension paths, so a provider that loses both races is not detectable.
- **Every launch has one contract.** Tool-call and service launches are routed the same way; no handler ordering is relied on.
- **Tools can be granted.** Assessment runs at launch for every agent. Declared `tools` are kept and `disallowed_tools` are never added.
- **Cost.** With the `tools` switch on, a launch with candidates costs one extra Jev request, sent concurrently with the worker request.
- **Superseded evidence.** Q1, Q2 and Q7 of the [host seams report](../evidence/2026-11-05-host-seams.md) no longer back a seam; their tests are retired.
