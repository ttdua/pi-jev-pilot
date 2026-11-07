## Design Summary

**Intent.** The first release ships the minimal main state. Five richer main-state field groups were designed in `docs/jev-contract.md` but are held off until replay evidence shows they help: `last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages` and `capabilities` (tools and subagents). WG-16 (issue #17) decides each group under one rule, and records the evidence in `docs/evidence/`. Every group gets a decision: keep it (ship it on) or remove it (delete the design). Both outcomes are success.

**Why now.** WG-09 (skills) and WG-13 (slots) are done, so the main and worker requests now have their final shape. The roadmap's working agreement holds rich fields off until this replay. `docs/privacy.md` still lists them as "pending".

**Decision rule (from the roadmap, unchanged).** There is no ground truth, so a metric alone cannot decide.
- A field group stays only if it changes more decisions than noise does, and the operator reads the changed cases and prefers the new answers. Otherwise it is removed.
- Agent `description` and instructions, and tool metadata, stay unless they clearly harm, because the operator asked for them.
- If reversing the order of the `effort` options shifts answers beyond noise, the operator picks a fixed order.

**What gets built.**
- Builders for the five field groups, in the package's own state module. They sit behind settings that are off by default, so behaviour does not change until a group is decided.
- A replay script, rebuilt from the method in the 2026-11-05 evidence because the earlier one-off scripts are not in this repository. It reads local sessions, rebuilds each sampled request as the package would have built it, calls Jev per variant, and writes two outputs:
  - aggregates, safe to commit;
  - a private table of differing cases, written outside the repository.
- A local, opt-in recorder of git change counts at each main prompt, because past diffs cannot be rebuilt.
- Evidence documents in `docs/evidence/`, plus updates to the contract, the privacy table and the roadmap, made once each group is decided.

**Corpus.** About 100 main prompts and about 46 worker briefs, resampled from current sessions.

**Variants.**
- Main side:
  - minimal state against full state;
  - each group added alone to minimal (add-one);
  - each group removed alone from full (leave-one-out);
  - a plain rerun to measure noise;
  - `effort` with reversed options, on minimal state.
- Worker side:
  - `parent_request` on;
  - agent `description` and instructions removed.

**Two passes in one change.**
- Pass 1: `last_decision`, `context_used_percent`, `languages`, `capabilities`, reversed options and the worker variants. It runs as soon as the tooling exists.
- Pass 2: `workspace.git`, after a few days of locally recorded counts.

The change closes when every group is decided.

**Goals**
- A decision for every field group, each backed by an evidence document.
- Replay that rebuilds requests with the same code that ships, so a kept field does not drift from what was measured.
- Repeatable runs: the method is written down, and the script lives in the repository.

**Non-goals**
- Tuning mode rubrics or tier mixes (#39).
- Claiming that a route is better. Replay shows where Jev routes, not whether the routed model does the work well.
- Rewriting the effort rubric (listed under "After 0.1").
- Adding Vietnamese patterns to the request signals.

**Anti-goals** (failure even if it technically works)
- Real prompts, briefs or per-case answers committed to the repository, or sent anywhere other than Jev.
- Any real Jev call without the operator's approval at that moment, stating the data and the estimated cost.
- A field kept on a metric alone, without the operator reading the changed cases.
- A difference smaller than noise reported as a result.
- Behaviour changing for current users before a group is decided: rich fields stay off by default.

**Constraints**
- `docs/testing.md` Replay rules:
  - the operator approves each run;
  - input stays outside the repository and only aggregates are committed;
  - every run includes a plain rerun;
  - each variant changes one thing.
- Package invariants: public Pi APIs only; fail open; `policy/` and the state builders stay pure; prompt text, tool arguments and tool output are never stored.
- Working agreements: stop before adding a dependency or changing a public command or file format.

## Alternatives Considered

### Alternative A: Builders only in the replay script
- **Approach**: The script computes the rich fields itself. The package code is written afterwards, only for groups that are kept.
- **Pros**: No package change until something is kept. Nothing to remove for dropped groups.
- **Cons**: Kept fields are written twice, and the shipped version can drift from what was measured.
- **Why not chosen**: The operator chose to measure the code that ships.

### Alternative B: Rebuild `workspace.git` from today's tree as a proxy
- **Approach**: Use the current diff of each session's working directory for every historical prompt.
- **Pros**: One pass. No recorder.
- **Cons**: The numbers are not what the user had at the time, and worktrees may be gone. The evidence would be low-trust by construction.
- **Why not chosen**: The operator preferred a few days of real counts.

### Alternative C: Git counts as a new optional ledger field
- **Approach**: Add `changed_files` and `diff_lines` to main ledger entries.
- **Pros**: One store. Lines up with decisions directly.
- **Cons**: Changes a file format and the privacy table. Hard to undo once released if git is dropped.
- **Why not chosen**: A separate replay-only file, off by default, keeps the ledger format untouched.

### Alternative D: Separate changes per pass
- **Approach**: Close WG-16 after pass 1 and open a follow-up for git.
- **Pros**: The issue closes sooner.
- **Cons**: Two changes for one decision rule. The git builder and the recorder would span changes.
- **Why not chosen**: The operator chose one change with two passes.

## Agreed Approach

The agreed approach:
- builders in the package behind off-by-default settings, and the script calls them;
- a separate, local, off-by-default git recorder for pass 2;
- add-one and leave-one-out ablation, with a noise rerun and reversed effort options;
- the worker corpus tests `parent_request` and dropping agent description and instructions;
- one change, two replay passes.

It measures exactly what would ship, avoids a ledger format change, and keeps users' behaviour unchanged until each group is decided.

## Key Decisions

All six were answered by the operator in the Inbox thread "WG-16 rich state replay":
1. Builders live in the package state module, behind settings that are off by default. The replay script calls them.
2. `workspace.git` is measured prospectively from locally recorded counts.
3. Ablation runs both add-one and leave-one-out.
4. The worker corpus tests `parent_request` and dropping agent description and instructions.
5. Git counts go to a separate replay-only local file (for example `jev-pilot/replay-git.jsonl`), off by default, numbers only.
6. One change with two replay passes. Git is decided in pass 2.

Calls of mine, open to correction:
- **Pass 2 sample.** It is the main prompts recorded during the logging window, not a resample of the 100.
- **Noise reruns.** There are two plain reruns, not one, because at about 100 samples a single rerun gives an unstable noise estimate.
- **Case table.** The private table holds only cases where at least one decided key changed, and lives under the operator's agent directory.
- **Dropped groups.** For each removed group, the builder and its setting are deleted, and the contract records the removal.

## Open Questions

- How each historical field is rebuilt (the ledger time match for `last_decision`, the context window source for `context_used_percent`, the tool and agent set for `capabilities`) is left to `design.md`.
- **Cost estimate.** It is stated at each approval, before any real call.
