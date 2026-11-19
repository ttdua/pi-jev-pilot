## Why

A child's result is free text. A caller that needs a contract (status, commits, sources used, findings) has to parse prose or a fenced YAML block, and when it is malformed it must resume the child after the child has already finished. Validating the result inside the child, while it can still fix it, removes that round-trip and the fragile parsing (#86).

## What Changes

**Result schema on service launches**
- From: `SpawnOptions` has no way to ask for a typed result; `SubagentRecord.result` is the only outcome.
- To: `SpawnOptions.resultSchema`, a JSON Schema in a draft 2020-12 subset (`type` object, array, string, number, integer, boolean; `enum`, `properties`, `items`, `required`, `additionalProperties`). `spawn` throws, creating no record, when the schema uses anything outside the subset or the launch resolves to `fork`.
- Reason: callers get a contract instead of prose.
- Impact: additive; omitted schema keeps today's behaviour exactly.

**`submit_result` child protocol tool**
- To: a launch with a schema installs `submit_result` next to `ask_parent` / `notify_parent`. It validates its argument in the child and returns the errors on failure; a valid call stores the value and ends the run after the current turn. `disallowed_tools` and launch-policy removals cannot remove it; it is never offered to a policy as a grant.
- Impact: only launches with a schema see the tool; tool counts of other launches do not change.

**Structured outcome on the record**
- To: `SubagentRecord.structuredResult` holds the valid value; `structuredResultError: "missing" | "invalid"` marks a run that ended without one. Both are per run: cleared when a run (initial or resume) starts, and a run ending on a pending `ask_parent` question records no error. `subagents:completed`, `subagents:failed` and `subagents:resumed` carry both fields when present. The free-text `result` is unchanged.

**Launch policy exclusion**
- From: `LaunchRequest.toolSet.parentTools` excludes `subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent` and `notify_parent`.
- To: it also excludes `submit_result`.
- Impact: non-breaking; a parent rarely has a tool by that name.

**Turn-limit stop settles `aborted` (fix found in verify, user-approved)**
- From: on a real provider session, the turn-budget stop aborts the in-flight request; the provider reports that turn as `stopReason: "error"` ("This operation was aborted"), the turn loop treats it as a provider failure, and the run settles `error`, although the executor README promises `aborted` with `phase: "exhausted"`.
- To: when the harness's own turn-budget stop ended the run, the aborted turn is not a provider failure; the run settles `aborted`, as documented, with or without a result schema.
- Reason: the "Turn limit reached" scenario of this change depends on it; the same bug affects every launch.
- Impact: bug fix to documented behaviour; a provider error unrelated to the budget stop still settles `error`.

**Out of scope**
- Schemas in agent frontmatter, a `subagent` tool parameter, structured results for forks, and full JSON Schema.

## Capabilities

### New Capabilities
- `structured-result`: `resultSchema` on service launches (subset, refusals), the `submit_result` tool (validation, run end, protection from removal), and the per-run structured outcome on records and events.

### Modified Capabilities
- `executor-launch-policy`: "Launch request given to the policy" excludes `submit_result` from `parentTools`.

## Impact

- **Vendored executor (`packages/pi-subagents/`):**
  - `src/service/service.ts`, `src/service/service-adapter.ts` (option, record fields, refusals)
  - new `src/seams/result-schema.ts` (subset check and validator) and `src/session/submit-result-tool.ts`
  - `src/lifecycle/create-subagent-session.ts`, `src/lifecycle/subagent.ts`, `src/lifecycle/subagent-run.ts`, `src/lifecycle/subagent-manager.ts`, `src/lifecycle/subagent-session.ts`
  - `src/seams/launch-request.ts`, `src/observation/subagent-events-observer.ts`
  - tests
- **Records:** every edited upstream file gets a row in `VENDORED.md`; `dist/public.d.ts` is regenerated and `verify:public-types` must pass.
- **Docs:**
  - `packages/pi-subagents/README.md` (the `spawn` contract, Events, the record fields);
  - `docs/architecture.md` (the seams line lists the result schema);
  - `docs/decisions/0009-vendored-executor.md` (seam list).
- **Dependencies:** none added.
- **jev-pilot `src/`:** no change.
