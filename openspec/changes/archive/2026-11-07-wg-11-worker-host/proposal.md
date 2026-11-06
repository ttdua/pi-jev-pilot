## Why

`wg-11-worker-policy` built the pure parts of worker routing, but nothing calls them: every `subagent` launch still runs on whatever the main model asked for. WG-11 (issue #12) is done only when a real child runs on the tier and thinking Jev's answers lead to, forked and resumed launches are handled as decided, an unusable tier cascades down with a clear warning, and a Jev outage changes nothing. This change wires the policy into Pi and records each launch in the ledger.

## What Changes

- Classify `subagent` launches: sibling launches together at `message_end`, a launch with no cached result (such as one issued by codemode, `parentToolCallId`) at its `tool_call`, within `timeoutMs`.
- Route each launch through one pure function: decision, effort, fallback and clamp, with forked, resumed and locked launches handled by effective values.
- Before writing, check the target model in Pi's registry and its credentials; cascade an unusable tier down, never to `expert`, with effort `xhigh` and a warning once per failing tier per session.
- Write `input.model` and `input.thinking`, replacing the caller's values; fail open on every Jev failure, missing key, invalid config, switch off or cancelled turn.
- Record one `worker` ledger line per launch on the executor's completion or failure, with the decision, raw answers, `locked`, `fallback`, `callerModel` and the outcome.
- New `config.json` setting `subagents.forkedLaunch` (`untouched` default, or `thinking`), approved by the operator during WG-11 explore.

**Forked launches**
- From: a launch with `inherit_context` is always left untouched.
- To: it follows `subagents.forkedLaunch`; `thinking` keeps the model and changes only the thinking level.
- Reason: operator decision 2026-11-06 (WG-02 Q7 open option); keeps the forked conversation's prompt cache while still adjusting effort.
- Impact: non-breaking; the default keeps the old behaviour.

**Unusable tier**
- From: tier cascade belonged to WG-13.
- To: WG-11 cascades a tier down with a warning; WG-13 keeps slots and their fallback to `balanced`.
- Reason: operator decision 2026-11-06.
- Impact: roadmap and issue #14 (WG-13) scope shrink.

Docs updated:
- `docs/domain-model.md`: forked launches, thinking-only launches, ledger `reason` for them.
- `docs/jev-contract.md`: worker eligibility, thinking-only requests.
- `docs/usage-guide.md`: troubleshooting row for workers keeping their model.
- `docs/workflow.md`: the worker launch sequence.
- `docs/configuration.md`: the `subagents` section and the full example.
- `docs/architecture.md`: `host/worker.ts` and `policy/route.ts` in the module layout.
- `docs/roadmap.md`: WG-11 status, WG-13 scope.

## Capabilities

### New Capabilities
- `worker-routing`: when and how a `subagent` launch is classified, which launches are left alone, the registry and credential check, the tier cascade warning, input mutation and fail-open behaviour.
- `worker-ledger`: the one `worker` ledger line per launch, its fields, and how the decision is joined to the executor's outcome.

### Modified Capabilities
- `config-file`: `subagents.forkedLaunch` joins the accepted fields.
- `settings-resolution`: the effective settings include `subagents.forkedLaunch`, default `untouched`.
- `worker-decision`: adds the pure launch route (decision, effort, fallback and clamp combined, including thinking-only launches) and the effort clamp.

## Impact

- New code: `src/policy/route.ts`, `src/host/worker.ts`, with unit and host tests.
- Changed code: `src/store/config.ts`, `src/store/settings.ts`, `src/store/defaults.ts` (new setting), `src/host/setup.ts` (wiring, and clearing shown warnings when `/jev` runs).
- `config.json` gains one optional key; `state.json` and the ledger format are unchanged. No new dependency.
- Issue #14 (WG-13) body updated to drop the tier cascade, after the operator approves the text.
