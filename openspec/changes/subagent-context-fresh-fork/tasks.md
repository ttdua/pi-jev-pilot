## 1. Spike: fork mechanics on the Pi SDK

Blocked by: none

Run the spike with model `9router/gpt-6-luna`, both for the agent doing this group and for the spike's real-provider probe.

- [ ] 1.1 Throwaway probe (not merged) under `packages/pi-subagents/test/spike/`: build a fork session with its own id, append a copied live branch plus a synthetic tool result, set `systemPromptOverride` to the parent's prompt and `tools` to the parent's tool names. Record the first request against the recording fixture.
- [ ] 1.2 Confirm that a `tool_call` handler returning `{ block: true }` refuses a declared tool without running it, and that the declarations stay unchanged.
- [ ] 1.3 List, per `pi-ai` provider API, where the session id reaches the provider (headers, `prompt_cache_key`). Confirm that `before_provider_headers` / `before_provider_request` can rewrite each one to the parent's id. Then send one parent turn and one fork through `9router/gpt-6-luna`, and record the fork's session headers and first-turn `cacheRead`.
- [ ] 1.4 Write the findings into the design's Open Questions resolution (a short note appended to `design.md`). Stop and escalate if the declarations cannot stay identical, or if blocking does not work.

## 2. Executor: context setting, resolution and deprecation

Blocked by: 1

- [ ] 2.1 `ContextMode` type and `context` on `AgentConfig`, `AgentInvocation`, the record and `LaunchRequest`; remove `promptMode` and `inheritContext` (`types.ts`, `seams/launch-request.ts`, `seams/launch-gate.ts`).
- [ ] 2.2 Frontmatter `context` parsing, the `inherit_context` alias, `prompt_mode` ignored, invalid-value warning, and the once-per-file-per-load warning (`config/custom-agents.ts`, `config/default-agents.ts`, `config/agent-types.ts`).
- [ ] 2.3 Resolution order (locked agent, call, deprecated call field, agent, `fresh`) with source tracking, plus `context` in the lock list (`config/invocation-config.ts`, `seams/locked-launch.ts`).
- [ ] 2.4 `subagent` tool parameter `context`, the `inherit_context` alias with a once-per-session warning, and the updated guideline text (`tools/agent-tool.ts`, `tools/spawn-config.ts`).
- [ ] 2.5 Service `spawn(..., { context })`, the `inheritContext` alias, and a validation error for invalid values (`service/service.ts`, `service/service-adapter.ts`).
- [ ] 2.6 Agent snapshot `context` (`seams/registry.ts`).

## 3. Executor: fresh prompt

Blocked by: 2

- [ ] 3.1 Fresh path in `lifecycle/create-subagent-session.ts`: context files enabled for the child's cwd, `systemPromptOverride: (base) => base + header + body`, `appendSystemPromptOverride: () => []`.
- [ ] 3.2 Replace `buildAgentPrompt` with a fresh composer; delete the inherited-identity, portable and `genericBase` code (`session/prompts.ts`, `session/session-config.ts`, and `session/project-context.ts` if unused).
- [ ] 3.3 Tests: no parent marker, project `AGENTS.md` present, `APPEND_SYSTEM.md` applied once, body last, no parent conversation.

## 4. Executor: fork session

Blocked by: 2, 3

- [ ] 4.1 Parent snapshot: live branch entries, effective system prompt, tool names, model, thinking and session id; remove `parentContext` and `buildParentContext` (`lifecycle/parent-snapshot.ts`, `session/context.ts`, `lifecycle/subagent-session.ts`, `runtime.ts`).
- [ ] 4.2 `lifecycle/fork-session.ts`: copy the entries into the fork's own session, add synthetic results for every pending call, and build the instructions message (active agent, cwd, body, agent-only tools, boundary).
- [ ] 4.3 Fork prompt and tools: parent system prompt override, parent tool names, no protocol tools; callable set from the existing tool pipeline intersected with the parent's tools; `tool_call` refusal extension.
- [ ] 4.4 Cache-routing key rewrite via `before_provider_headers` / `before_provider_request`, per the spike's field list.
- [ ] 4.5 Model and thinking precedence for forks (locked, policy, caller, parent), and the policy's requested value (`session/model-resolver.ts` or `config/invocation-config.ts`, `seams/launch-gate.ts`).
- [ ] 4.6 No-parent-session handling: an explicit fork fails before session creation; an agent-file fork falls back to fresh with `contextFallback`.
- [ ] 4.7 Fork tool facts: callable count as tools, the rest blocked; `context` on `subagents:child:session-created`.

## 5. Executor: display

Blocked by: 4

- [ ] 5.1 `getContextLabel(context, fallback)` returns `fork` / `fork → fresh` / nothing; remove `getPromptModeLabel` and the `inherit context` tag (`ui/display.ts`).
- [ ] 5.2 Take the label from the run in `tools/spawn-config.ts`, `tools/result-renderer.ts`, `ui/widget-renderer.ts`, `ui/session-navigation.ts`, `ui/session-navigator.ts`.
- [ ] 5.3 Update tests that assert `twin` / `inherit context` (`test/ui/*`, `test/tools/*`, `test/widget-renderer.test.ts`, `test/display.test.ts`).

## 6. jev root: rename and fork-aware wiring

Blocked by: 2, 4

- [ ] 6.1 `subagents.forkLaunch` with the `forkedLaunch` alias, deprecation notice, both-keys problem, and the `/jev` status notice (`src/store/config.ts`, `settings.ts`, `settings-sections.ts`, `defaults.ts`, status rendering).
- [ ] 6.2 Launch mapping and routing on `context === "fork"` (`src/policy/launch.ts`, `src/policy/worker/route.ts`, `src/host/worker/request.ts`, `src/host/worker/route.ts`, `src/host/platform/agents.ts`).
- [ ] 6.3 Child registry keeps the context; `hideReviewInChild` skips forks; `jev_review` still refuses in any child (`src/host/platform/*`, `src/host/wiring/turn.ts`, `src/host/review/tool.ts`).
- [ ] 6.4 Unit tests for config, settings, route, request and agent facts; update scenarios named "Forked …".

## 7. Host evidence and cache evidence

Blocked by: 3, 4, 5, 6

- [ ] 7.1 `tests/host/launch-policy-evidence.test.ts`: switch the `inherit_context` launch to `context: "fork"`; add an untouched fork keeping the parent prefix byte-for-byte; check the marker inside a tool result.
- [ ] 7.2 Host tests: parallel forks share the prefix up to the synthetic result; a fork refuses a disallowed tool and `jev_review`; fresh has no parent marker; explicit fork with no parent fails.
- [ ] 7.3 Manual evidence run (real Anthropic plus one OpenAI-compatible provider, outside CI): `docs/evidence/<date>-fork-cache.md` with the matrix, conditions and the 90% bound.

## 8. Docs, decision record and migration

Blocked by: 3, 4, 5, 6

- [ ] 8.1 ADR `packages/pi-subagents/docs/decisions/0014-subagent-context-is-fresh-or-fork.md`; status lines in ADRs 0006, 0008, 0009, 0010 and 0011.
- [ ] 8.2 `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md`, `VENDORED.md`, `CHANGELOG.md` (migration section).
- [ ] 8.3 `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/jev-contract.md`, `docs/domain-model.md`, `docs/roadmap.md`; grep check for old names outside the exempt places.
