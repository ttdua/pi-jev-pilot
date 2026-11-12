# Run facts on subagent rows, end to end (2026-11-12)

Change `subagent-row-details` (Refs #63). A real interactive Pi in tmux (120x40) against the loopback fixture `tests/host/manual/fleet-fixture.ts`, executor-only install, `PI_OFFLINE=1`.

## Setup

- Pi: `node_modules/.bin/pi --version` → `1.5.0`; executor: vendored `pi-subagents` with this change.
- Fixture: `bun tests/host/manual/fleet-fixture.ts` (prints `AGENT_DIR=`, `CWD=`, `BASE_URL=`, `STATUS_FILE=`). It writes the project agent `.pi/agents/fleet-probe.md` (`disallowed_tools: bash`) into `CWD`. Prompt `launch` makes `fixture-main` call `subagent` twice with `subagent_type: fleet-probe`, `model: fixture/fixture-fast`, `thinking: low`: one with `run_in_background: true` (FLEET-BG), one foreground (FLEET-FG). Children reply `done` after 20 s.
- Pi: `tmux new-session -d -s rd-e2e -x 120 -y 40 -c $CWD "env HOME=$AGENT_DIR/home PI_CODING_AGENT_DIR=$AGENT_DIR PI_OFFLINE=1 pi --provider fixture --model fixture-main"`, then `tmux send-keys -l launch` + `Enter`; screens by `tmux capture-pane -p` (temp paths shortened to `<tmp>`, blank lines dropped).

Expected facts: `🔧8` = the 7 core built-ins minus `bash`, plus `ask_parent` and `notify_parent`; `⊘1` = `bash` removed by `disallowed_tools`; `thinking: low` and `fixture/fixture-fast` as requested (no launch policy).

## Step 1 — while both run (7 s after `launch`)

```
 launch
 ▸ fleet-probe  fleet FLEET-BG
   ⎿  Running in background (ID: 06012991-7a79-44e)
 ▸ fleet-probe  fleet FLEET-FG
 ⠴ fixture/fixture-fast · twin · thinking: low · 🔧8 · ⊘1 · ↻0
   ⎿  thinking…
● Agents
└─ ⠇ fleet-probe (twin) [fixture/fixture-fast · thinking: low · 🔧8 · ⊘1]  fleet FLEET-BG · ↻0 · 7.0s
     ⎿  thinking…
── ⠦ Working ───────────────────────────────────────────────────────────────────────────────────────────────────────────
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  esc to interrupt · ← for agents · ↓ to manage
  ○ main
  ○ fleet-probe  fleet FLEET-BG  fixture/fixture-fast · thinking: low · 🔧8 · ⊘1                         7s · ↓ 0 tokens
  ○ fleet-probe  fleet FLEET-FG  fixture/fixture-fast · thinking: low · 🔧8 · ⊘1                         7s · ↓ 0 tokens
<tmp>
↑10 ↓5 0.0%/128k (auto)                                                                  (fixture) fixture-main • medium
1 running agent
```

- **Inline result (foreground):** `fixture/fixture-fast · twin · thinking: low · 🔧8 · ⊘1 · ↻0`. The order is model, mode label, thinking, tool facts, then the turn budget, as before. The spinner and activity line are unchanged.
- **`Agents` widget (background):** `[fixture/fixture-fast · thinking: low · 🔧8 · ⊘1]` in the place of the former `[fixture/fixture-fast]` tag. The name, `(twin)`, description, `↻0`, elapsed and activity line are unchanged.
- **Fleet rows:** the same facts follow the description, and the right-aligned `7s · ↓ 0 tokens` stays whole.

## Step 2 — both finished (25 s after `launch`)

```
 launch
 ▸ fleet-probe  fleet FLEET-BG
   ⎿  Running in background (ID: 06012991-7a79-44e)
 ▸ fleet-probe  fleet FLEET-FG
 ✓ fixture/fixture-fast · twin · thinking: low · 🔧8 · ⊘1 · ↻1 · 15 token · 20.1s
   ⎿  Done
 ok
✓ fleet FLEET-BG completed
  ↻1 · 15 token · 20.1s
  ⎿  done
  transcript:
<tmp>
<tmp>
<tmp>
 ok
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
<tmp>
↑30 ↓15 0.0%/128k (auto)                                                                 (fixture) fixture-main • medium
```

- **Inline result (completed):** `✓ fixture/fixture-fast · twin · thinking: low · 🔧8 · ⊘1 · ↻1 · 15 token · 20.1s`, then `⎿ Done`. Every part shown before this change is still present.
- **Fleet list:** cleared after the 4 s linger, as specified by `fleet-view`.

## Result

The three surfaces show the same model, thinking, tool count and blocked count, from one formatter. No previously shown detail is missing.
