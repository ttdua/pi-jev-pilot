## Design Summary

**Intent.** WG-14 (roadmap H2) lets Jev judge, for a worker whose agent declares no `tools`, which of the tools it was given are dangerous or clearly inappropriate for its task. The first release is about evidence: by default (`tools.mode: observe`) nothing changes for the worker, and the ledger records how many tools were scored and how many would have been removed, so the operator can decide from real data whether to switch to `enforce`. In `enforce`, flagged tools are removed from the worker before its first request.

**Who it serves.** The operator, who wants to narrow general-purpose workers without writing a `tools` list for every agent, and who will not trust removal until the ledger shows what it would do.

**Goals.**

- Assessment runs inside the worker's own session, at its first `before_agent_start`, with one Jev request (one noul per tool, at most 32 tools).
- `observe`: the worker's tools are unchanged; `toolsScored` and `toolsFlagged` appear on that launch's `worker` ledger line.
- `enforce`: flagged tools are absent from the worker's provider requests for its whole life, and a call to one fails.
- A Jev failure (timeout, error, bad answers) keeps every tool.
- `ask_parent` and `notify_parent` are never candidates.

**Non-goals.**

- Adding tools. Assessment can only remove.
- Assessing agents that declare `tools`, the main session, or launches not made through the executor.
- Tuning the 0.5 threshold or the question wording (wording stays provisional until replay).
- A new ledger kind or any other file format change.

**Anti-goals.** The feature fails, even if it works technically, if:

- a worker in `observe` behaves differently than without the package (except the bounded wait for Jev);
- a missing executor record, a lookup error or a Jev failure removes a tool;
- prompt text, tool arguments or tool output reach the ledger.

**Constraints.** Public Pi and executor APIs only; fail open; decide on probabilities; `policy/` stays pure and only `host/` touches Pi; no new dependency; tests need no secrets, paid calls or network beyond loopback.

**What the worker session knows, and how it learns the rest.** The worker session knows its own session file and its first prompt (the brief). It does not know which agent it is. The executor publishes `getSubagentsService()` on `globalThis`; its `listAgents()` records carry the agent id, the agent type and the description, plus `outputFile`, which is the worker's session file. The worker session finds its record by that file, reads the agent's declared tools the same way worker routing does, and hands the counts back through a process-wide map keyed by the agent id, which the parent already knows when it writes the `worker` line.

## Alternatives Considered

### Alternative A: Match the launch by brief
- **Approach**: The parent puts each pending launch (agent facts, description) in a process-wide map keyed by its brief; the worker session looks itself up by its first prompt and writes counts back into the entry.
- **Pros**: Needs nothing from the executor beyond what is verified today.
- **Cons**: Two launches with the same brief cannot be told apart; the counts can land on the wrong line; the map needs its own expiry.
- **Why not chosen**: The executor already exposes an exact key (`outputFile`), so a heuristic key is unnecessary.

### Alternative B: Worker session only
- **Approach**: The worker session assesses from its own prompt and `selectedTools`, with no agent name.
- **Pros**: No coordination with the parent.
- **Cons**: Cannot tell an agent that declares no `tools` from one that declares all of them; the request lacks the agent name and description the contract asks for; counts cannot reach the `worker` line.
- **Why not chosen**: Breaks the "only agents that declare no tools" rule and the ledger requirement.

### Alternative C: Wait for an executor change
- **Approach**: Ask `@gotgenes/pi-subagents` to add the tool call id and agent name to `subagents:child:session-created`, and block WG-14 on it.
- **Pros**: The cleanest key, carried by the event the package already uses.
- **Cons**: Blocks the work group on another project's release.
- **Why not chosen**: The public service API already gives an exact match today. The gap is in this package, not in the executor.

## Agreed Approach

Find the executor record by session file (`outputFile` from `getSubagentsService().listAgents()`), chosen by the operator over Alternatives A to C because it is exact for concurrent background workers and uses only public APIs. With the record, the worker session knows its agent, reads the agent's declared tools, and runs assessment only when there are none. Counts go into a process-wide map keyed by the agent id; the parent's existing ledger writer reads them when it writes that launch's `worker` line.

## Key Decisions

- **Mechanism** (operator): match by `outputFile` through `getSubagentsService().listAgents()`; no record, no assessment, all tools kept.
- **Waiting** (operator): the worker session waits for Jev in both `observe` and `enforce`, bounded by `classifier.timeoutMs`, so both modes take the same path and `observe` measures what `enforce` would do.
- **No worker line** (operator): when routing writes no `worker` line (`subagents` off, or a skipped launch), the counts are recorded nowhere; assessment still runs and `enforce` still removes.
- **Candidates** (operator): every tool in the worker's selected tools except `ask_parent` and `notify_parent`. `jev_review` is already removed in worker sessions before assessment, so it is never a candidate.
- **Once per worker** (proposal): assessment runs at the worker's first `before_agent_start` only. Later turns and resumed runs reuse the flagged set, so `enforce` removes the same tools on every turn without a new Jev call.
- **Switches** (proposal): assessment runs only with the `tools` switch on, a valid config, the API key set and the executor present, like the other features. `tools.mode` comes from config; it is not a `/jev` command.
- **Brief** (proposal): the brief sent to Jev is the worker's first prompt, as the session receives it; it is sent, never stored.

## Open Questions

- Host evidence still owed: the executor record exists in `listAgents()`, with `outputFile` set, by the time the worker session's first `before_agent_start` runs. This is read from executor 25.0.5 source and must be confirmed by a host test; if it fails, the design falls back to Alternative A, which needs the operator's go-ahead.
