# 0006: Use `@gotgenes/pi-subagents` as the executor

**Status:** Superseded by [0009](0009-vendored-executor.md), 2026-11-11. Originally accepted 2026-11-05.

## Context

The port pins a fork of `pi-subagents` with a custom decision-authority API, plus a required-child-extension mechanism that allows one owner per session. The operator chose `@gotgenes/pi-subagents`: a published package with a typed service, lifecycle events and in-process children.

## Decision

Depend on its public surface: the `subagent` tool's `model` and `thinking` parameters, lifecycle events on `pi.events`, and the child binding the parent's extensions. It is an optional peer: without it, worker features are off and the rest works.

## Consequences

- No fork to maintain.
- **Tool assessment can only remove tools.** The executor admits extension tools only through an agent's `tools` frontmatter.
- `locked` agent fields win over routing, by design.
- Launches through `SubagentsService.spawn()` are not routed.
- No public registry of agents, so agent files are read directly, with a table for built-ins that must be checked on upgrades.
- It replaces the fork's tool, and existing agent files need review.
