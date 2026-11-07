## Context

`mainState` in `src/jev/state.ts` builds the minimal state: `request`, `conversation.{recent, recent_tools, turn_index}` and `workspace.platforms`. The five rich groups exist only as prose in `docs/jev-contract.md`. `scripts/` may import `jev/`, `policy/` and `shared/`, but not `host/` or `store/` (`.oxlintrc.json`). The session reader `branchItems` and `scanPlatforms` currently sit in `src/host/context.ts`.

The local data falls into three sources:
- Sessions written since 2026-10-25 come mostly from the earlier port. For each turn they carry `jev-pilot:effort` entries with `requested` and `decision.strategy`.
- Sessions run under this package carry `jev-turn` entries, with `strategy` kept in its ledger.
- Worker briefs are the `subagent` tool calls in session files.

Past tool sets and past diffs are not recorded anywhere.

## Goals / Non-Goals

**Goals:**
- Replay builds each request with exactly the builders that would ship.
- Each variant changes one thing, and noise is measured twice.
- Nothing per-case is written inside the repository. No real call happens without `--send`.

**Non-Goals:**
- Replaying the skill pick. The skill catalog is not a rich field, it costs about ten times more per request, and today's catalog differs from the catalog at the time.
- Making any route better. The replay only reports where routing goes.

## Decisions

**D1. Shipped groups are a code constant, not config keys.**
- Decision: `SHIPPED_MAIN_GROUPS` in `src/jev/state.ts` starts empty. The host builds inputs only for listed groups. A kept group is added to the constant.
- Why: a decided field is on for everyone, so a user switch is not needed. Config keys would be a public format change, and keys for dropped groups would have to be removed again.
- Alternative: one `state.<group>` key per group in `config.json`.
- Note: this follows the brainstorm's "flags off by default" in an internal form.

**D2. Shared readers move to `jev/`.**
- Decision: `branchItems` moves to `src/jev/branch.ts` and takes a structural entry type, with no Pi import. `scanPlatforms` and the new `scanLanguages` live in `src/jev/workspace.ts`, which reads names only. `src/host/context.ts` re-exports them, so existing imports and tests keep working.
- Alternative: copy the readers into the script.
- Why not: copies drift, which is exactly the risk the operator ruled out.

**D3. Field rules.** All rules are calls of mine and are documented in the contract.
- **`last_decision`** = `{ effort, strategy }` of the previous answered main turn in this session. A key the turn did not decide is omitted.
  - Live: `createMain` keeps a `lastDecided` value, set when an answered turn settles (`effective` or `requested`, `strategy`) and cleared on `session_start`. After a reload the field is omitted.
  - Replay: taken from the nearest earlier `jev-pilot:effort` entry on the branch (`requested`, `decision.strategy`), or from the nearest earlier `jev-turn` entry joined with the ledger by `turnId`.
  - Omitted on the first turn.
- **`context_used_percent`** = integer `round(percent)`, clamped to 0–100.
  - Live: `ctx.getContextUsage()`. The field is omitted when it reports `null`, for example right after compaction.
  - Replay: `totalTokens` of the last assistant message before the prompt, divided by the model's context window from the `--models` file (saved `pi --list-models` output). Omitted after a compaction entry with no assistant message since.
- **`workspace.git`** = `{ changed_files, diff_lines }`, parsed from `git diff HEAD --shortstat`. `diff_lines` is insertions plus deletions; untracked files are not counted. A directory that is not a repository, or a command that fails, omits the field.
  - Live: a host helper runs `pi.exec` with a 500 ms timeout, plus a 500 ms `Promise.race`. A result with a non-zero `code`, or `killed` or `truncated` set, gives no field. It starts before the first `await` in `decide`, and its result is shared with the recorder.
  - Replay: joined from the recorder by `turnId`.
- **`workspace.languages`** = at most 5 language names, most files first, with ties broken by name.
  - Scope: names only, at most 3 levels deep, at most 5000 entries, with the platform scan's skipped directories and symlinks skipped.
  - Extensions map to a fixed table of about 25 languages. A language needs at least 3 files and at least 5% of the recognised files.
  - When nothing qualifies, the value is `["none found"]`.
  - Replay uses today's tree at the session's `cwd`. Samples whose `cwd` is gone are excluded from the languages variants, and that count is reported.
- **`capabilities`** = `{ tools: [{ name, summary }], subagents: [{ name, description, tools }] }`.
  - `summary` is the first sentence of the description, at most 200 code points. Agent `description` is cut to 200 code points. Lists are capped at 40 tools and 30 agents, in name order.
  - Live: tools come from `pi.getActiveTools()` and `pi.getAllTools()`; agents from the same listing `readAgent` uses (`.pi/agents/`, `<agentDir>/agents/`, built-ins).
  - Replay: one snapshot taken today by a manual host procedure, holding the tools and the full `AgentFacts` of every listed agent. It is labelled as an approximation in the evidence. Worker samples take their agent facts from the same snapshot, because `readAgent` lives in `host/`. Without it, the worker variants are skipped.

**D3a. Host units.**
- `src/host/rich.ts`: `buildRichInputs` gathers the inputs of the shipped groups. Each group is wrapped so it fails open on its own. `decide` makes one call.
- `src/host/git.ts`: `gitCounts(exec, cwd)`, where `setup.ts` passes `pi.exec`.
- `listAgents` is exported from `src/host/agents.ts`. It uses the same precedence as `readAgent` (project, then global, then built-ins), and both live capabilities and the snapshot procedure use it.
- Wiring goes in `src/host/setup.ts`, because `extension.ts` may import only `host/`.

**D4. Recorder switch is an environment variable.**
- Decision: `JEV_REPLAY_GIT=1`. It is documented in `docs/testing.md` as part of the replay procedure, not in `docs/configuration.md`.
- Why: it is temporary and only for the operator, and it adds no config key.
- Behaviour:
  - each line is `{ v: 1, at, session, turnId, changedFiles, diffLines }`;
  - writes are owner-only, with no rotation;
  - writing stops at 5000 lines;
  - a failure is swallowed, so the recorder fails open.
- Timing: it runs off the request path, after `before_agent_start` has returned.

**D5. Replay script shape.** The script lives in `scripts/replay/`, split into one module per stage:
- `sessions.ts` reads a session into entries and branches.
- `corpus.ts` samples with a seed:
  - Main prompts, stratified by project and by recorded starting effort. It excludes children, slash-command and `<skill` prompts, and exact duplicates.
  - Worker briefs, stratified by agent kind (implementation, review, scout or verify).
- `variants.ts` builds one state per variant.
- `run.ts` handles concurrency (8), the timeout (5000 ms) and one retry on a miss.
- `compare.ts` builds the aggregates and the case table.
- `cli.ts` handles the arguments.

Arguments:

| Flag | Role |
|---|---|
| `--pass 1\|2` | Which pass to run |
| `--kept <groups>` | Pass 2 only: the groups shipped after pass 1 |
| `--seed` | Sampling seed |
| `--main` | Number of main prompts (default 100) |
| `--workers` | Number of worker briefs (default 46) |
| `--capabilities <file>` | Snapshot file for the capabilities group; without it, those variants are skipped |
| `--models <file>` | Output of `pi --list-models`, for context windows |
| `--url` | Jev endpoint, defaults to the configured one |
| `--send` | Without it the run is dry and prints only counts and an estimated cost |

Variants:
- Main, pass 1:
  - `minimal`, `rerun-a`, `rerun-b`, `full`;
  - add-one for each of 4 groups, and leave-one-out for each of 4 groups;
  - `effort-reversed`, on the minimal state.
- Main, pass 2: `minimal`, two reruns, `full`, `+git`, `full-git`. Here `full` is the groups kept after pass 1 plus `git`, given with `--kept`.
- Workers:
  - `base`, `rerun-a`, `rerun-b`;
  - `parent-request`;
  - `no-description` (the agent `description` emptied);
  - `no-instructions` (`instructions_excerpt` emptied).

The script reads the ledger (`ledger.jsonl`, `ledger.1.jsonl`) with its own line parser, because `store/` is off limits. It needs only `turnId`, `effective` and `strategy`, and skips any line it cannot parse.

Main questions are effort, risky, tier, strategy and corrects, with skills off. Worker questions are tier, effort and risky, plus `expert_needed` when an expert tier is configured. Both are built by the package's own question builders, using the operator's current config read from `<agentDir>/jev/config.json`. Reading that file takes plain JSON parsing in the script, because `store/` is off limits.

**D6. Comparison rule.**
- Each variant is compared with its base on each decided key: effort level (`decideEffort`), tier, strategy, `risky > .7`, `corrects >= CORRECTION_THRESHOLD`, and the final worker tier and effort.
- The noise for a key is the larger flip count of `rerun-a` and `rerun-b` against the base.
- A variant counts as beyond noise when its flips exceed that noise. Every aggregate shows both numbers.
- A miss in either side of a pair excludes the pair, and misses are reported per variant.
- The operator's preference is decided separately, by reading the case table.

**D7. Outputs.**
- Location: `<agentDir>/jev/replay/<run-id>/`, owner-only, where `<agentDir>` is `PI_CODING_AGENT_DIR` or `~/.pi/agent`.
- `aggregates.json` holds counts only.
- `cases.md` lists every pair whose decision differs. For each pair it gives the first 300 code points of the prompt or brief, both answers, and the probabilities.
- The evidence document is written by hand from `aggregates.json`. Nothing under `scripts/` writes into the repository.

**D8. Applying the decisions.**
- A kept main group goes into `SHIPPED_MAIN_GROUPS`. The contract's IMPORTANT note and `docs/privacy.md` are updated.
- A removed group has its builder, tests and contract rule deleted.
- The worker outcome edits `buildWorkerState` and the `worker-request` spec only when a field is dropped. If `parent_request` should become the default, that changes a documented default and needs the operator's explicit yes.
- If the reversed `effort` order shifts beyond noise, the operator picks the order, which is then fixed in `src/jev/questions.ts`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Capabilities and languages are rebuilt from today's state, not the state at the time | The evidence labels them; languages excludes samples whose `cwd` is gone |
| About 100 samples give a coarse noise estimate | Two reruns; both numbers shown; the operator reads the cases |
| Moving `branchItems` and `scanPlatforms` breaks imports | `host/context.ts` re-exports them; existing tests run unchanged |
| The git exec adds latency once git ships | 500 ms timeout, started in parallel with the other inputs; on timeout the field is omitted |
| The case table holds the operator's real prompts | Owner-only under `<agentDir>`, never in the repository; the procedure says to delete it after the decision |
| Cost of a run | The dry run prints the estimate. About 1300 main and 280 worker requests in pass 1, at about 7 KB and 6 KB each, comes to roughly 10–15 US cents |

## Migration Plan

- No user-visible change until a group is added to `SHIPPED_MAIN_GROUPS`.
- Rollback is a one-line change: remove the group from the constant.
- The recorder file can be deleted at any time.

## Open Questions

- None that block implementation. The decision per group is the outcome of the work, not an input to it.
