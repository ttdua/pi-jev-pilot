---
status: accepted
date: 2026-11-12
---

# 0013 — The fleet list opens the session pane

## Status

Accepted.
Takes the "widget gesture" that [ADR 0004] Criterion 3 left as a later option.
It adds a navigation surface and does not change the read-only rule of Criterion 2.

## Context

[ADR 0004] Criterion 3 chose a command as the primary way to pick a parallel agent: `/subagents:sessions` lists agents, the operator picks one, and its transcript opens read-only.
It left a widget gesture as an optional later enhancement, because the background widget already shows N agents as a per-agent tree.

The command needs a prompt-free round trip to reach an agent: type the command, pick from the list.
An operator watching several subagents has no way to move between them from the prompt.

The `tintinweb/pi-subagents` 0.23.2 fleet list shows a below-editor roster of `main` and the running agents, and opens an agent with one key.
Its list logic (row filter, ordering, windowing, the 4 s linger, the key handling) is ported into this package, credited in `NOTICE.md`, and recorded in `VENDORED.md`.
Its viewer, workflows, mentions, cost and handoff features are not ported.

## Decision

A below-editor list shows `main` and the agents that have a transcript the pane can open.

- A row is an agent with a live session or an output file, that is running, queued, settled less than 4 s ago, or currently viewed.
  A settled record whose session is still held drops out after 4 s like any other.
- Foreground and background records both qualify.
  The list's job is navigation, not progress, and the foreground stream does not show the other agents.
- The list appears when at least one agent row exists.
- With an empty prompt, `↓` or `←` enters the list on the first agent.
  `↑` and `↓` move, `Enter` opens the agent, `Esc` or `↑` past `main` leaves.
  Finished agents linger for 4 s.
- `Enter` opens the existing read-only `/subagents:sessions` pane.
  The list and the command share one open step (`openTranscript`), so the pane mounts the same way from both.
- The list has no steer, stop, handoff or other control.
- The list reads focus through the public `tui.getFocusedComponent()` and acts only when the focused component is the prompt editor, recognized by its `getText` and `setText` functions.
- The list is on by default and is turned off by the `fleetView` setting in `/subagents:settings` (`Fleet view`).

The ported behavior is credited to `tintinweb/pi-subagents` 0.23.2 (MIT) in `NOTICE.md`.
Where the fork's conventions differ (no agent colors, no cost, no viewer), the port adapts them and does not copy upstream's file.

## Consequences

- While agents run, `↓`, `←` and `↑` at an empty prompt no longer reach the editor's history until the list is left.
  `↑` is untouched until the list is entered, and `fleetView` turns the whole list off.
- A foreground agent can appear in the list while its `subagent` call is still inline; the list is an index of transcripts, not a second progress view.
- The list selects the first agent, not `main`, so one key reaches a transcript.
  This departs from upstream, which selects `main` first.
- The list shows only rows the pane can open, so `Enter` never reaches a dead end.
- The list redraws once a second while it is shown or any agent is running or queued.
  Rows show whole seconds and have no spinner, so the cost is frames only.
- The fork's vendored diff grows by two new UI modules, the `openTranscript` and `navigationEntryFor` extractions, the `fleetView` setting and the wiring in `index.ts`.
  Each is listed in `VENDORED.md`, and upstream sync must carry them.

[ADR 0004]: 0004-reconsider-ui-direction.md
