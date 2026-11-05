# 0001: Use public Pi APIs only

**Status:** Accepted, 2026-11-05

## Context

The earlier port attaches context per request through `context`, tied to user messages by an extra `jevPilotInputId` property. Its own README calls this a version-tested dependency, not a documented guarantee, and much of its complexity follows from it.

## Decision

Use only documented APIs. Main-session context goes through `before_agent_start`'s `message` with `display: false`. Workers go through `tool_call` input mutation and the child's `before_agent_start`.

## Consequences

- Much less code, and upgrades are less likely to break it.
- Injected skills and advice are real session history until compaction, so duplicates must be prevented.
- They follow history across forks, rather than being rebuilt per branch.
- Assumptions that documentation does not settle are verified in [WG-02](../roadmap.md#wg-02-host-seam-verification).
