# Fleet list end to end (2026-11-12)

Change `fleet-view-port` (Refs #62). A real interactive Pi in tmux (120x40) against the loopback fixture `scripts/e2e/fleet-fixture.ts`.

## Setup

- Pi: `node_modules/.bin/pi --version` → `1.5.0`; executor: vendored `pi-subagents` 25.0.5 plus the fleet list (checkout, executor-only fixture install; Jev stays off, no key needed).
- Fixture: `bun scripts/e2e/fleet-fixture.ts` prints `AGENT_DIR=`, `CWD=`, `BASE_URL=`, `STATUS_FILE=`. The first `launch` prompt makes `fixture-main` call `subagent` twice (one `run_in_background: true`, one foreground, model `fixture/fixture-fast`); children reply `done` after 20 s; the `again` prompt makes one background launch with a 20 s child.
- Pi: `tmux new-session -d -s fleet-e2e -x 120 -y 40 -c $CWD "env HOME=$AGENT_DIR/home PI_CODING_AGENT_DIR=$AGENT_DIR PI_OFFLINE=1 pi --provider fixture --model fixture-main"`; keys through `tmux send-keys` (`Down`, `Enter`, `Escape`, literal text); screens through `tmux capture-pane -p` (temp paths shortened to `<tmp>`).

## Step 1 — list below the editor (prompt `launch`)

```
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                                6s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                                6s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

(The widget sits under the editor rule, with the hint line, `○ main`, the background and the foreground agent.)

## Step 2 — `Down` at an empty prompt

```
  ↑↓ select · enter view · esc back

  ○ main
  ● Agent  fleet FLEET-BG                                                                               12s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               12s · ↓ 0 tokens
```

## Step 3 — `Enter` opens the session pane

```

 FLEET-BG


◍ thinking…
── 5 lines · 100% ────────────────────────────────────── ↑↓ scroll · PageUp/PageDown · Ctrl+Home/Ctrl+End · Esc close ──
```

## Step 4 — `Esc` closes the pane, `Esc` again leaves the list

After the first `Esc` the list is back with `●` on the first agent; after the second all markers are `○` and the hint is `esc to interrupt · ← for agents · ↓ to manage`; the prompt is empty.

```
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                               18s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               18s · ↓ 0 tokens
```

## Step 5 — `abc` then `Down`

`abc` stays in the prompt and every marker stays `○` (list not activated):

```
── ⠼ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────
abc
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                               20s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               20s · ↓ 0 tokens
```

## Step 6 — list disappears after the agents finish

On a second run the screen was polled every 0.5 s: once the children replied (20 s fixture delay) the list left the screen and only the `ok` reply remained. The disappearance was observed within the poll window after completion; the 4 s linger itself is not timed to the second here (covered by `fleet-list.test.ts`).

```

 ok

```

## Step 7 — `Fleet view` off, prompt `again`

`/subagents:settings` lists `Fleet view (current: on)`; selecting it printed `Fleet view: off`. After `again`, the fixture recorded the child request (`seq 7`, `fixture-fast`, `FLEET-AGAIN`), the `Agents` widget above the editor showed the running agent, and no list appeared below the editor (no `esc to interrupt · ←` hint on screen).

```
● Agents
└─ ⠏ Agent (twin) [fixture/fixture-fast]  fleet FLEET-AGAIN · ↻0 · 4.5s
     ⎿  thinking…
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
```

## Results

| Expected behavior | Result |
| --- | --- |
| List below the editor with hint, `○ main`, one row per running agent (background and foreground) | PASS |
| `↓` at an empty prompt makes the first agent row `●` | PASS |
| `Enter` opens the pane with header `── Agent (twin)  fleet FLEET-BG ...` | PASS |
| `Esc` closes the pane; `Esc` again leaves the list; prompt empty | PASS |
| `abc` then `↓` does not activate the list | PASS |
| List disappears after all agents finish | PASS (not timed to 4 s) |
| `Fleet view` off: `again` launches (fixture recorded the child), no list | PASS |

Gates: `bun run lint`, `bun run fmt:check`, `bun run typecheck` pass. Fixture, tmux session and temp dirs removed afterwards.
