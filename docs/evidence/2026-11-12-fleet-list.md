# Fleet list end to end (2026-11-12)

Change `fleet-view-port` (Refs #62). A real interactive Pi in tmux (120x40) against the loopback fixture `scripts/e2e/fleet-fixture.ts`. Re-captured with full editor/footer regions (second run).

## Setup

- Pi: `node_modules/.bin/pi --version` → `1.5.0`; executor: vendored `pi-subagents` 25.0.5 plus the fleet list (executor-only fixture install; Jev stays off, no key needed).
- Fixture: `bun scripts/e2e/fleet-fixture.ts` prints `AGENT_DIR=`, `CWD=`, `BASE_URL=`, `STATUS_FILE=`. `launch` makes `fixture-main` call `subagent` twice (one `run_in_background: true`, one foreground, model `fixture/fixture-fast`); children reply `done` after 20 s (`delayMs`); `again` makes one background launch with a 20 s child. The status file lists each request's seq, model, fixture marker and `repliedAt` (epoch ms when the child reply streamed).
- Pi: `tmux new-session -d -s fleet-e2e -x 120 -y 40 -c $CWD "env HOME=$AGENT_DIR/home PI_CODING_AGENT_DIR=$AGENT_DIR PI_OFFLINE=1 pi --provider fixture --model fixture-main"`, then `tmux set-option -t fleet-e2e window-size manual` and `resize-window -x 120 -y 40`. Keys by `tmux send-keys` (`Down`, `Enter`, `Escape`, literal text); screens by `tmux capture-pane -p` (temp paths shortened to `<tmp>`).
- Layout of a screen, top to bottom: transcript, `● Agents` widget (above editor), `── Working` rule (editor top), the prompt line(s), the editor bottom rule, the fleet list (below the editor), cwd line, footer.

## Step 1 — list below the editor (prompt `launch`)

Bottom 16 rows of the 40-row capture (editor top rule `── ⠦ Working ──`, empty prompt line, editor bottom rule, then the list, cwd, footer):

```

● Agents
└─ ⠇ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 6.9s
     ⎿  thinking…
── ⠦ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                                7s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                                7s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

## Step 2 — `Down` at an empty prompt

```

● Agents
└─ ⠙ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 8.0s
     ⎿  thinking…
── ⠏ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ↑↓ select · enter view · esc back

  ○ main
  ● Agent  fleet FLEET-BG                                                                                8s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                                8s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

First agent row is `●`, hint switched to `↑↓ select · enter view · esc back`.

## Step 3 — `Enter` opens the session pane (full 40-row capture)

The pane mounts in place of the editor/list region; its header rule names the agent (`── Agent (twin)  fleet FLEET-BG · ...`), then the transcript, then the footer rule with `Esc close`:

```

 ▀▀█  v1.5.0
 █▀ █ escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more
 Press ctrl+o to show full startup help and loaded resources.

 Pi can explain its own features and look up its docs. Ask it how to use or extend Pi.

[Extensions]
  src


 launch



 ▸ Agent  fleet FLEET-BG
   ⎿  Running in background (ID: 29cccea1-4ca0-459)



 ▸ Agent  fleet FLEET-FG
 ⠦ fixture/fixture-fast · twin · ↻0
   ⎿  thinking…


● Agents
└─ ⠋ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 9.5s
     ⎿  thinking…
── ⠧ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
── Agent (twin)  fleet FLEET-BG · fixture/fixture-fast • medium ────────────────────────────────────────────────────────

 FLEET-BG


◍ thinking…
── 5 lines · 100% ────────────────────────────────────── ↑↓ scroll · PageUp/PageDown · Ctrl+Home/Ctrl+End · Esc close ──
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

## Step 4a — first `Esc`: pane closed, list still active

Editor rules with the empty prompt line between them, list below with `●` on the first agent:

```

● Agents
└─ ⠹ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 10.5s
     ⎿  thinking…
── ⠋ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  ↑↓ select · enter view · esc back

  ○ main
  ● Agent  fleet FLEET-BG                                                                               10s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               10s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

## Step 4b — second `Esc`: list left, prompt empty

Same region; markers all `○`, inactive hint, prompt line between the rules empty:

```

● Agents
└─ ⠴ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 11.5s
     ⎿  thinking…
── ⠸ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                               12s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               12s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

## Step 5 — `abc` then `Down`

`abc` sits on the prompt line (between the rules) and every marker is `○`, hint inactive: the list did not activate.

```

● Agents
└─ ⠼ Agent (twin) [fixture/fixture-fast]  fleet FLEET-BG · ↻0 · 13.1s
     ⎿  thinking…
── ⠹ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────
abc
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                               13s · ↓ 0 tokens
  ○ Agent  fleet FLEET-FG                                                                               13s · ↓ 0 tokens

<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

## Step 6 — list disappears after the agents finish

Polled every 0.25 s. The children replied at the fixture at `repliedAt` = 1794419344.692 (last child, seq 2, from the status file). The last poll that still showed the list was at 1794419349.351 (+4.66 s), the first poll without it at 1794419349.624 (+4.93 s). Measured linger: **about 4.7–4.9 s** after the last reply (4 s linger plus the 1 s refresh tick, within the 4–5.5 s window).

Last capture with the list (rows show 20 s elapsed, `↓ 15 tokens`):

```

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage

  ○ main
  ○ Agent  fleet FLEET-BG                                                                              20s · ↓ 15 tokens
  ○ Agent  fleet FLEET-FG                                                                              20s · ↓ 15 tokens

<tmp>
↑30 ↓15 0.0%/128k (auto)                                                                 (fixture) fixture-main • medium
```

First capture without the list (editor rules, prompt, footer, nothing between rule and cwd line):

```

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
<tmp>
↑30 ↓15 0.0%/128k (auto)                                                                 (fixture) fixture-main • medium
```

## Step 7 — `Fleet view` off, prompt `again`

`/subagents:settings` listed `→ Fleet view (current: on)`; selecting it printed ` Fleet view: off`. After `again` the `Agents` widget shows the running `FLEET-AGAIN` child above the editor, the editor rules and prompt follow, and nothing is drawn between the editor bottom rule and the cwd line (no `○ main`, no hint):

```
   ⎿  Running in background (ID: d2ee3043-e8e0-455)


 ok

● Agents
└─ ⠙ Agent (twin) [fixture/fixture-fast]  fleet FLEET-AGAIN · ↻0 · 4.5s
     ⎿  thinking…
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
<tmp>
↑50 ↓25 0.0%/128k (auto)                                                                 (fixture) fixture-main • medium
1 running agent
```

Explicit fixture assertion (the `again` child reached the fixture), `bun scripts/e2e/fleet-fixture.ts --check-again $STATUS_FILE`:

```
CHECK-AGAIN OK: seq 7 fixture-fast [{"type":"text","text":"FLEET-AGAIN"}]
exit=0
```

Against a file without that request it exits 1 (verified with a non-status file).

## Results

| Expected behavior | Result |
| --- | --- |
| List below the editor with hint, `○ main`, one row per running agent (background and foreground) | PASS (step 1) |
| `↓` at an empty prompt makes the first agent row `●` | PASS (step 2) |
| `Enter` opens the pane with header `── Agent (twin)  fleet FLEET-BG ...` | PASS (step 3) |
| `Esc` closes the pane; `Esc` again leaves the list; prompt empty | PASS (steps 4a, 4b) |
| `abc` then `↓` does not activate the list | PASS (step 5) |
| List disappears about 4 s after all agents finish | PASS (measured 4.7–4.9 s incl. 1 s tick) |
| `Fleet view` off: `again` launches (fixture recorded the child), no list | PASS (step 7) |

Gates: `bun run lint`, `bun run fmt:check`, `bun run typecheck` pass. Fixture, tmux session and temp dirs removed afterwards.
