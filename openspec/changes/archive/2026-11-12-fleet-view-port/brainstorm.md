## Design Summary

Bring back a FleetView-style list of running subagents, as the operator used in
`tintinweb/pi-subagents`, inside the vendored executor `packages/pi-subagents/`.
Tracked in ttdua/pi-jev-pilot#62.

**Why.** While several subagents run, the operator wants to see them all at a
glance at the bottom of the screen and jump into one with a key, without typing
`/subagents:sessions` and picking from a menu. The vendored fork
(`gotgenes/pi-packages` `pi-subagents-v25.0.5`) never shipped FleetView; it only
has the above-editor widget (background runs) and the `/subagents:sessions`
command.

**What the operator sees.**

```
  > _                                    <- editor, empty prompt
  ──────────────────────────────────────
  ● main
  ○ Explore   audit auth flow      12s · ↓13.1k
  ○ worker    fix flaky tests       4s · ↓2.0k
                                    ↓ 3 more
```

- The list renders **below the editor**, at the bottom, only while at least one
  subagent is running (or has just finished).
- It lists `main` plus **every running subagent, foreground included**,
  earliest launched first. Each row shows the agent's display name, its
  description, and elapsed time and tokens on the right. Richer row facts
  (model, thinking, tool counts) are ttdua/pi-jev-pilot#63, not this change.
- At an empty prompt with the editor focused, `↓` (or `←`) moves focus into the
  list; `↑`/`↓` move the selection; `Esc`, or `↑` above `main`, returns to the
  prompt. Selecting `main` and pressing `Enter` returns to the prompt.
- `Enter` on a subagent row opens **the existing session page**, the same pane
  `/subagents:sessions` opens for that agent. No second viewer is built.
- Finished agents stay in the list for a few seconds, then drop out.
- The list can be turned off in `/subagents:settings`.

**Goals.** One-key access to any running subagent's existing session page; an
always-visible roster of what is running.

**Non-goals.** Steering or stopping from the list or from the page (dropped
from this change by the operator); a new conversation viewer; workflows,
`ctrl+b` background handoff, `@mentions`, cost display; extra row facts (#63).

**Anti-goals.** The list must never take keys from another focused component
(a dialog, a selector, the session page itself) or from a non-empty prompt;
typing, history and cursor movement at the prompt must behave as before. It must
not duplicate the transcript renderer.

**Existing specs involved.** `executor-vendoring` ("Upstream provenance": every
edited upstream file and new file gets a `VENDORED.md` row, enforced by the
vendoring test; "Upstream license kept"; "No runtime import across the two
extensions"). `package-loading` ("Extension registrations are bounded") may
need its bound reviewed if the list adds a registration. No jev-pilot spec under
`src/` changes behavior; Jev is not called by this feature.

## Alternatives Considered

### Alternative A: Port tintinweb's list and its ConversationViewer
- **Approach**: Port `fleet-list.ts` and `conversation-viewer.ts` (about 1,500
  lines) with steer and stop.
- **Pros**: Identical to what the operator used before.
- **Cons**: A second transcript renderer next to the existing pane; depends on
  modules the fork removed (`AgentManager`, workflows, mentions); hard to keep
  in sync.
- **Why not chosen**: The operator said the page already exists and must not be
  duplicated.

### Alternative B: List plus steer/stop added to the existing page
- **Approach**: The list opens the existing pane, which gains a steer composer
  and `x x` stop.
- **Pros**: Full tintinweb behavior on a single page.
- **Cons**: Turns a read-only pane interactive, superseding the fork's ADR 0004;
  larger scope.
- **Why not chosen**: The operator dropped steer and stop from this change.

### Alternative C: List built in jev-pilot's `src/`
- **Approach**: jev-pilot draws the list from the executor service and events.
- **Pros**: No vendored files edited.
- **Cons**: jev-pilot cannot open the executor's page without a new service
  method; agent rendering split across two packages.
- **Why not chosen**: The page and records live in the executor; the list
  belongs next to them.

## Agreed Approach

A list-only port inside the vendored executor: take the list behavior from
tintinweb's FleetView (placement, key handling, focus guard, ordering,
lingering finished rows, overflow), and make `Enter` open the existing
`/subagents:sessions` page for the selected agent. Chosen by the operator in
the review thread; it is the smallest change that gives one-key access without
duplicating the page.

## Key Decisions

- Placement below the editor, at the bottom (operator).
- `↓` enters the list and selects a running subagent; `Enter` opens the existing
  session page (operator).
- Foreground subagents are listed too (operator).
- No steer, no stop in this change (operator).
- Lives in the vendored executor, recorded in `VENDORED.md`; `NOTICE.md` credits
  `tintinweb/pi-subagents` (MIT) for the ported list behavior (agent's call).
- On by default, with an off switch in `/subagents:settings` that persists like
  the other settings (agent's call, matching tintinweb's default).
- Row content in this change: display name, description, elapsed, tokens;
  overflow after a fixed number of rows (agent's call; #63 extends the row).

## Open Questions

- None blocking. The exact linger time and row cap are left to the design,
  defaulting to tintinweb's values.
