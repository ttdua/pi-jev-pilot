# 0007: No mid-turn effort escalation

**Status:** Accepted, 2026-11-05

## Context

Upstream raises effort after two consecutive tool failures. It looks like a safety net for turns misjudged as easy. On 500 real turns, that trigger occurred twice.

The turns it would need to rescue exist: 23 of 291 `low` turns reached at least 15 tool calls and account for 29% of output tokens. They do not fail in a row, so this trigger does not see them.

## Decision

Not included. Pi could support it, through `tool_result` and `setThinkingLevel`. The trigger is what lacks evidence.

## Consequences

- A turn misjudged as easy stays at its level.
- The ledger records large turns at low effort as a signal. A better trigger, if one exists, can be measured from it before anything is built.
