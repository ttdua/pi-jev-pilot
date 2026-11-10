## 1. Vendor the executor unchanged

Blocked by: none

- [ ] 1.1 Split `packages/pi-subagents` from `gotgenes/pi-packages` at the `@gotgenes/pi-subagents` 25.0.5 release and add it with `git subtree add --squash` under `packages/pi-subagents/` (design D2)
- [ ] 1.2 Rename the vendored workspace to `@ttdua/pi-subagents`, `private: true`; keep its `imports` map; drop `pnpm-lock.yaml`; stop its `lint` script calling `pnpm` (D4, D13)
- [ ] 1.3 Add `packages/pi-subagents` to root `workspaces`; set root `pi.extensions` to `./packages/pi-subagents/src/index.ts` then `./src/extension.ts`; set root `peerDependencies` to `pi-ai`, `pi-coding-agent`, `pi-tui`, `typebox`; remove the `@gotgenes/pi-subagents` devDependency; refresh `bun.lock` (specs `executor-vendoring`, `package-loading`, `host-test-harness`)
- [ ] 1.4 Write `packages/pi-subagents/VENDORED.md` (upstream repo, path, tag, commit, local-change list) and add the `NOTICE.md` entry (spec `executor-vendoring` "Upstream provenance", "Upstream license kept")
- [ ] 1.5 Add a repository test that fails when an upstream file under `packages/pi-subagents/` differs from the recorded commit without a `VENDORED.md` entry
- [ ] 1.6 Add root script `test:executor` running the vendored unit tests and type check; exclude `packages/` from jev-pilot's lint, `tsc`, function-size rules and import-graph scope; extend the import-graph test to reject runtime imports of `packages/` or `@ttdua/pi-subagents` from `src/` while allowing `import type`; run both suites in CI
- [ ] 1.7 Switch the host-test harness to install the checkout (both extensions) and add a fixture package that installs only the executor; update package-loading tests for two entry points and the new peers
- [ ] 1.8 Checkpoint: run `bun run test`, `bun run test:executor` and the host suite unchanged in behavior; if Pi cannot resolve `#src/*` for the nested extension, rewrite to relative imports and record it in `VENDORED.md` (design Risks)

## 2. Executor: service identity, launch identity and effective launch facts

Blocked by: 1

- [ ] 2.1 Publish the service from `session_start` in main sessions only, using the executor's own child-session record; carry `implementation` and `sessionId`; unpublish only when the published service is its own (spec `executor-vendoring` "Service identity and ownership")
- [ ] 2.2 Add `agentId`, `agentType` and `toolCallId` (tool-door launches only) to `subagents:child:spawning|session-created|bound`, and `toolCallId` to `subagents:created|started|completed|failed|resuming|resumed` (spec `executor-launch-identity`)
- [ ] 2.3 Record `effectiveModel` and `effectiveThinking` at child session creation; add them to `session-created` and to `SubagentRecord` as optional fields (spec `executor-launch-identity` "Effective model and thinking")
- [ ] 2.4 Unit tests in the vendored package for every scenario above; existing upstream tests pass unchanged; record new files and touched upstream files in `VENDORED.md`

## 3. Executor: agent registry query and `disallowed_tools`

Blocked by: 1

- [ ] 3.1 Parse `disallowed_tools` (list or comma string) into agent config; keep provenance so a missing `tools` field stays distinct from defaults
- [ ] 3.2 Add `listAgentTypes()` and `getAgentType(name)` returning frozen snapshots (`tools` or `null`, `defaultTools`, `disallowedTools`, `instructions`, `locked`, …), reloading agent files first, launch-equivalent name resolution, nothing for disabled agents (spec `executor-agent-registry`)
- [ ] 3.3 Apply `disallowed_tools` last when building the child's tool allowlist, with a debug note when a tool is both declared and disallowed
- [ ] 3.4 Unit tests for every scenario of `executor-agent-registry`; update `VENDORED.md`

## 4. Executor: launch policy provider and tool grants

Blocked by: 2, 3

- [ ] 4.1 Add `registerLaunchPolicy(policy, { timeoutMs })` with one slot, a throwing second registration and an unregister function (spec `executor-launch-policy` "One launch policy slot")
- [ ] 4.2 Call the policy in the record start path after dequeue and before `createSubagentSession`, for tool and service launches, never for resume; build the `LaunchRequest` (origin, requested values after `locked`, `toolSet` with parent tools minus excluded packages and orchestration tools) (D8)
- [ ] 4.3 Apply the adjustment with precedence rules (locked fields, declared tools, `disallowed_tools`, parent-only grants), dropping violating entries with debug notes; load built-in extensions for granted built-ins
- [ ] 4.4 Fail open on throw, reject, malformed value or watchdog timeout; abort the policy signal; honour launch cancellation
- [ ] 4.5 After child bind and before the first provider request, keep only grants the child registered with a model-callable exposure, and report `grantedTools` on `subagents:child:bound` (spec "Grants are checked in the child")
- [ ] 4.6 Unit tests for every scenario of `executor-launch-policy`; update `VENDORED.md`

## 5. jev-pilot: configuration, ledger schema and agent facts

Blocked by: 1

- [ ] 5.1 Add `tools.grantAt` (0.5–1, default 0.8) to config validation and settings resolution (specs `config-file`, `settings-resolution`)
- [ ] 5.2 Add `effectiveModel`, `effectiveThinking` and `toolsGranted` to the worker line schema and exported field sets (spec `decision-ledger`)
- [ ] 5.3 Replace `src/host/platform/agents.ts` with a pure mapper from the executor's agent snapshot to `AgentFacts` (including `disallowedTools`), never copying `model`/`thinking` values (spec `agent-metadata`); delete the built-in table and file reader
- [ ] 5.4 Feed `capabilities.subagents` from `listAgentTypes()`, empty without the executor or on error (spec `main-state`)
- [ ] 5.5 Unit tests for each changed requirement

## 6. jev-pilot: readiness and duplicate detection

Blocked by: 2, 5

- [ ] 6.1 Implement the three-state executor check after bind: `duplicate` from the winning `subagent` tool's `sourceInfo` or a non-vendored `implementation`; `present` from the captured main service; `absent` otherwise (spec `readiness-checks`)
- [ ] 6.2 Report `duplicate executor` with the other path and the uninstall advice in `/jev`, with worker routing and tool assessment off (spec `jev-command`)
- [ ] 6.3 Unit and host tests for both load orders and for "present after children"

## 7. jev-pilot: routing and tool assessment through the launch policy

Blocked by: 4, 5, 6

- [ ] 7.1 Register the policy at main `session_start` with a 10 s watchdog, unregister at shutdown and before re-registering; report a held slot in `/jev` (spec `worker-routing` "Routing is the executor's launch policy", "Launch policy slot taken")
- [ ] 7.2 In the policy, skip child-originated launches; treat a service launch naming a model as model-locked through request, route and ledger; run the existing worker decision unchanged and return `model`/`thinking` (specs `worker-routing`, `worker-decision`)
- [ ] 7.3 Rebuild tool assessment as a policy step: block and grant candidates from `toolSet` with exclusions and a 32 total cap, `tool::` and `grant::` questions, `tools.grantAt`, observe and enforce, concurrent with routing under one fresh `classifier.timeoutMs` deadline, fail open (spec `tool-assessment`); add the `grant::` wording to `src/jev/questions.ts` and `docs/jev-questions.md`, leaving `RUBRIC_VERSION` at 2
- [ ] 7.4 Join outcomes by `agentId` from executor events; take `effectiveModel`/`effectiveThinking` from `session-created` and `toolsGranted` from `bound`; write no line for resumes or pre-policy refusals (spec `worker-ledger`)
- [ ] 7.5 Remove the `message_end`, `tool_call` and `tool_result` handlers, the launch book's tool-call keyed paths, the `outputFile` lookup and the child-side assessment; keep the child guard that hides `jev_review`; update the registration-bound test (spec `package-loading`)
- [ ] 7.6 Unit tests for every changed scenario in `worker-routing`, `worker-decision`, `worker-ledger` and `tool-assessment`

## 8. Host evidence and end-to-end checks

Blocked by: 7

- [ ] 8.1 Retire the Q1, Q2 and Q7 host tests; keep Q3–Q6 pinned (spec `host-seam-evidence`)
- [ ] 8.2 Add host tests for "Launch policy host evidence": policy model and thinking in foreground, background, service and inherited-context launches; locked field wins; watchdog timeout falls open; grant reaches and is callable; `disallowed_tools` wins over a grant; effective model on the ledger line equals the child's first request
- [ ] 8.3 Mark Q1, Q2 and Q7 superseded in `docs/evidence/2026-11-05-host-seams.md`, with links to the new tests
- [ ] 8.4 Run an end-to-end session through the installed checkout with the fixture provider: a routed tool launch, a service spawn, an enforce-mode grant, `/jev` output, and the ledger line

## 9. Documentation and release notes

Blocked by: 7

- [ ] 9.1 New ADR superseding 0006 (vendored executor, maintenance cost, upstream sync); mark 0006 superseded; update `docs/decisions/README.md`
- [ ] 9.2 Update `docs/architecture.md` (host seams table, runtime contexts, module map), `docs/domain-model.md`, `docs/workflow.md`, `docs/jev-contract.md`, `docs/glossary.md`, `docs/testing.md`, `docs/roadmap.md`, `docs/project-brief.md`
- [ ] 9.3 Update `README.md`, `docs/usage-guide.md` and `docs/configuration.md`: one install, uninstall `@gotgenes/pi-subagents` first, `disallowed_tools`, `tools.grantAt`, the duplicate-executor limit
- [ ] 9.4 Add a `CHANGELOG.md` entry marking the breaking change
