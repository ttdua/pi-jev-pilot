## Design Summary

WG-11 (issue #12) routes each `subagent` launch to a model tier and a thinking level chosen from Jev's answers. The first change, `wg-11-worker-policy` (PR #27, merged), built the offline parts: agent metadata reader, worker request, decision order, effort rules and fallback choice. This second change, `wg-11-worker-host`, wires them into a running Pi session so that the WG-11 "done when" holds:

- a real child runs on the chosen model and thinking, in foreground and background;
- `resume` is untouched, and a forked launch follows `subagents.forkedLaunch`;
- an unusable tier cascades down, never to `expert`, with a clear warning;
- a Jev outage leaves launches unchanged.

What the operator sees:

- **Routing.** When the main model calls `subagent`, the worker runs on the tier Jev's answers lead to, with the decided thinking level. The caller's own `model` and `thinking` are replaced, and the ledger keeps what the caller asked for (`callerModel`).
- **Forked launches.** A launch with effective `inherit_context` follows the new `config.json` setting `subagents.forkedLaunch`. `untouched` (default) leaves it as it is. `thinking` keeps the model and changes only the thinking level, which preserves the forked conversation's prompt cache.
- **Resumed launches** are always left alone.
- **Locked agents.** When an agent file locks `model`, Jev is still asked and only thinking is written. When it locks both `model` and `thinking`, nothing is asked and nothing is written. Either way the ledger records `locked`.
- **Unusable target.** Before writing, the target model is checked against Pi's model registry and its credentials. An unusable tier moves down to the next tier that can run, never to `expert`, with effort `xhigh`. A warning names the failing tier, the tier used instead and the setting to fix. It shows once per failing tier per session, and again after `/jev` or the config changes. If no tier can run, the launch is unchanged.
- **Failure.** Jev timeout, error, unreadable answers, no key, invalid config, the `subagents` switch off, or a cancelled turn: the launch proceeds exactly as without the package.
- **Ledger.** One `worker` line per routed or untouched launch, written when the worker finishes, with the decision, the raw answers, `locked`, `fallback`, `callerModel` and the outcome (`status`, duration, tokens, tool uses).

Docs deferred from change 1 are brought in line here: the four forked-launch passages (domain model, Jev contract, usage guide, workflow), the configuration reference, the roadmap and issue #14.

## Alternatives Considered

### Alternative A: Pure router plus a thin host adapter
- **Approach**: One new pure function in `policy/` combines decision, effort, fallback and clamp for one launch from plain inputs (answers, offered tiers, effective launch, `forkedLaunch`, which tiers can run, the target's thinking support). A host module handles only Pi events, the per-message cache, the registry check, input mutation, warnings and the ledger.
- **Pros**: Every branch (fork modes, locks, cascade, miss) has a table test without Pi; follows the architecture's pure-policy principle and the change 1 pattern.
- **Cons**: One more policy file and a wider input type.
- **Why not chosen**: Chosen.

### Alternative B: All routing logic in the host module
- **Approach**: The host handler calls the change 1 functions directly and holds the fork, lock and cascade branches itself.
- **Pros**: Fewer files.
- **Cons**: Those branches are only testable through slow host tests; goes against "pure policy" in `docs/architecture.md`.
- **Why not chosen**: Harder to test and to replay offline.

### Alternative C: Two ledger lines per launch
- **Approach**: Write the decision at launch and the outcome on completion as separate lines.
- **Pros**: A decision is not lost when the process dies before the worker finishes.
- **Cons**: The ledger requires `status` and never rewrites a line, so this changes the ledger file format, which needs separate operator approval and is outside WG-11.
- **Why not chosen**: Format change out of scope; a lost line on a crash is acceptable.

## Agreed Approach

Alternative A, chosen by the operator. Pure combination of the existing change 1 rules in `policy/`, with the host adapter limited to Pi seams, so the behaviour above can be table-tested and the live host test only has to prove the seams.

## Key Decisions

Settled during WG-11 explore (issue #12 comment) and this brainstorm:

- Sibling launches are classified together at `message_end`; a launch issued by another tool (`parentToolCallId`, such as codemode) is classified at its `tool_call`, within `timeoutMs`.
- `resume` and `inherit_context` are effective values: the launch input, else the agent file, honouring `locked`.
- New setting `subagents.forkedLaunch: "untouched" | "thinking"`, default `untouched`. The operator approved this `config.json` addition during explore.
- A forked launch in `thinking` mode asks Jev only `effort` and `risky`, since the model is kept.
- The caller's `model` and `thinking` are overridden; `callerModel` is recorded.
- Untouched launches (resume, forked with `untouched`, both fields locked) are recorded with `reason: untouched`. When no request is possible at all (switch off, no key, invalid config, executor absent, child session), nothing is recorded.
- Unusable tier: cascade down, never to `expert`, effort `xhigh` on every tier; warning once per failing tier per session, again after `/jev` or a config change; ledger `fallback`. The cascade moved here from WG-13; WG-13 keeps slots.
- One ledger line per launch, written on the executor's completion or failure, joined through the agent id the tool result reports. A launch the executor refuses (no agent id) is written as `status: error` from the tool result. A crash before completion loses that line.
- Errors while a child runs are not retried.

## Open Questions

- None blocking. Exact warning wording and the in-memory limits of the per-message cache are left to design.
