## Why

Worker routing and tool assessment reach `@gotgenes/pi-subagents` only through seams it happens to expose. As a result they rest on guesses: launches are joined to children by `outputFile` and to outcomes by `details.agentId`, agent files are parsed twice, service `spawn()` launches are never routed, and tools can only be removed. Upstream rations provider seams and keeps tool policy in another package, so these contracts will not come from upstream. Vendoring the executor and adding explicit seams turns the guesses into contracts and lets tool assessment grant tools as well as block them.

## What Changes

- **Vendored executor.** `@gotgenes/pi-subagents` is brought into `packages/pi-subagents/` with `git subtree`, as its own workspace with its own toolchain. The root manifest lists both extensions; one `pi install` installs jev-pilot with its executor. ADR 0006 is superseded.
- **Executor seams (in the vendored core, generic):** launch identity on lifecycle events; effective model and thinking per launch; an agent registry query; a launch policy provider consulted for every launch; per-launch tool grants; `disallowed_tools` in agent frontmatter.

**Executor dependency**
- From: `@gotgenes/pi-subagents` is an optional, separately installed peer; present when a `subagent` tool exists.
- To: worker features require the vendored executor; a second `subagent` provider (the original package) is reported as a problem.
- Reason: no fallback code for the original executor.
- Impact: breaking for users who installed `@gotgenes/pi-subagents`; they must uninstall it.

**Worker routing**
- From: `message_end` pre-classification plus `tool_call` input mutation; tool-call launches only.
- To: one launch policy provider decides every main-session launch, tool call or `spawn`; another extension's explicit model is kept; child-originated launches are untouched.
- Reason: one contract for every launch path, no dependence on handler ordering.
- Impact: non-breaking for decisions; ledger volume may grow.

**Tool assessment**
- From: runs in the child, only for agents without `tools`, can only remove tools ("MUST NOT add a tool").
- To: runs at launch for every agent; `tools` are always kept, `disallowed_tools` never present, Jev decides block or add for the rest, with candidates drawn from the parent session's tools. New `grant::` question; the worker `tier` rubric version is unchanged.
- Reason: let workers get the tools a task needs while respecting agent authors.
- Impact: launch waits for assessment within the routing timeout; ledger tool counts gain granted tools.

**Agent facts**
- From: agent files parsed by jev-pilot, plus a built-in table checked by hand on upgrades.
- To: read from the executor's registry.
- Reason: one source of truth.
- Impact: non-breaking; removes upgrade checks.

**Launch to outcome join**
- From: `outputFile` match and `details.agentId` from tool results.
- To: identifiers carried by executor events; the ledger can record effective model and thinking.
- Reason: deterministic joins.
- Impact: ledger schema gains fields.

## Capabilities

### New Capabilities
- `executor-vendoring`: the vendored package location, upstream sync, toolchain and tests, license notice, and the combined manifest.
- `executor-launch-identity`: launch identity on lifecycle events and effective model and thinking per launch.
- `executor-agent-registry`: the service query for resolved agent definitions, including `disallowed_tools`.
- `executor-launch-policy`: the launch policy provider (scope, ordering with `locked`, time bound, fail-open) and per-launch tool grants.

### Modified Capabilities
- `agent-metadata`: agent facts come from the executor registry instead of reading files and a built-in table; `disallowed_tools` added.
- `worker-routing`: routing moves from `message_end`/`tool_call` mutation to the launch policy provider; scope extends to main-session `spawn`.
- `worker-decision`: launches untouched now include another extension's `spawn` with an explicit model.
- `worker-ledger`: outcome join by executor identifiers; effective model and thinking recorded.
- `decision-ledger`: worker line schema gains effective-launch and granted-tool fields.
- `tool-assessment`: runs at launch for every agent, respects `tools` and `disallowed_tools`, can grant tools, new question.
- `readiness-checks`: executor presence means the vendored executor; duplicate `subagent` provider is a problem.
- `jev-command`: `/jev` reports the duplicate-executor problem.
- `package-loading`: manifest lists two extensions; peer dependencies and the handler set change.
- `host-test-harness`: the pinned `@gotgenes/pi-subagents@25.0.5` devDependency is replaced by the vendored workspace.
- `host-seam-evidence`: Q1, Q2 and Q7 seams are superseded; their tests are retired and the evidence report marks them superseded. Q3 stays: it still hides `jev_review` in children.
- `main-state`: `capabilities.subagents` comes from the executor's `listAgentTypes()`.
- `config-file`: new `tools.grantAt` field rule.
- `settings-resolution`: `tools.grantAt` default `0.8`.

## Impact

- **Code:** `src/host/worker/*`, `src/host/tools/*`, `src/host/platform/agents.ts`, `src/host/setup.ts`, `src/policy/tools/*`, `src/jev/questions.ts`, `src/jev/rubrics.ts`, `src/store/ledger-schema.ts`; new `packages/pi-subagents/` (vendored, with seams).
- **Dependencies:** root peer dependencies gain `@earendil-works/pi-ai` and `@earendil-works/pi-tui`; the `@gotgenes/pi-subagents` devDependency is removed.
- **Tests:** host tests Q1–Q4 and tool assessment rewritten; the vendored package's own tests run in CI next to Bun's.
- **Docs updated:** `docs/architecture.md` (host seams, runtime contexts), `docs/decisions/0006-gotgenes-executor.md` (superseded) and a new ADR, `docs/decisions/README.md`, `docs/usage-guide.md` (install, removing the original executor, `disallowed_tools`), `docs/configuration.md`, `docs/jev-contract.md` and `docs/jev-questions.md` (tool question), `docs/domain-model.md`, `docs/workflow.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/project-brief.md`, `docs/evidence/2026-11-05-host-seams.md`, `README.md`, `NOTICE.md`.
