## Why

A subagent's starting context is set by two overlapping knobs:

- `prompt_mode`: `replace` still prepends the parent identity, so it is never really fresh.
- `inherit_context`: pastes a lossy text dump of the parent conversation under the child's own system prompt, so the parent's prompt cache misses on the whole history.

The names promise behaviour the code does not deliver, and the UI shows two unrelated labels (`twin`, `inherit context`). Claude Code and pi.dev's `pi-subagents` have converged on `fresh` and `fork`. Adopting the same split gives clean fresh children by default, and forks cheap enough to use routinely because they reuse the parent's cache (issue #88).

## What Changes

**Subagent context setting**
- From: `prompt_mode: replace | append` (agent file) plus `inherit_context: boolean` (agent file, `subagent` tool, service `spawn`).
- To: one setting, `context: fresh | fork`, on the `subagent` tool, the agent frontmatter (lockable) and the service `spawn` options. Resolution order: call, then agent file, then `fresh`.
- Reason: one axis whose names match behaviour.
- Impact: **breaking** for agent files and callers. The old fields keep working for one minor release with deprecation warnings: `inherit_context: true` means `fork`, and `prompt_mode` is ignored.

**Fresh child prompt**
- From: parent identity prefix + header + agent body, in both prompt modes.
- To: the system prompt Pi builds for the child's own session (its tools, its directory's project instructions, its skills catalog), followed by the agent body. No parent identity and no parent conversation.
- Reason: a clean child that still follows project rules.
- Impact: breaking for anyone relying on the shared identity prefix (ADR 0008 is superseded).

**Fork child**
- From: the text-rendered history (no tool results) prepended to the task, under the child's own prompt.
- To:
  - the parent's real conversation, cloned;
  - the parent's system prompt, tool declarations, model and thinking;
  - the agent's instructions and the task in the next message.
- Supporting rules:
  - disallowed tools are refused at call time;
  - parallel forks from one turn share the cache prefix;
  - an explicit fork with no parent session fails, while an agent-file default falls back to fresh with a recorded notice;
  - a fork cannot spawn.
- Reason: a real fork that reuses the parent's prompt cache.
- Impact: forks become cheaper and more faithful. A fork with a model or thinking override still runs, but misses the cache.

**Display**
- From: `twin`, taken from the agent type's prompt mode, plus a separate `inherit context` invocation tag.
- To: a single `fork` label, taken from the run's context, on the widget, the inline tool result, the session navigator and the run facts. A fresh run shows no label. `twin` is removed.
- Impact: visible text change.

**jev root setting**
- From: `subagents.forkedLaunch`.
- To: `subagents.forkLaunch`, with the same values and default. The old key is read for one minor release with a warning.
- Impact: config migration.

## Capabilities

### New Capabilities
- `subagent-context-mode`: the `fresh` / `fork` setting, its resolution and deprecation shims, the fresh prompt, the fork session (clone, prompt and tool reuse, instructions message, call-time tool refusal, no nested spawn, shared prefix), fallback rules and fork cache evidence.

### Modified Capabilities
- `subagent-run-facts`: the inline stats order replaces `twin` and `inherit context` with one `fork` label taken from the run; the widget line takes its label from the run.
- `executor-agent-registry`: the agent snapshot carries `context` instead of `inheritContext`.
- `agent-metadata`: the agent facts carry `context` instead of `inheritContext`.
- `executor-launch-policy`: the launch request given to the policy carries `context` instead of `inheritContext`.
- `host-seam-evidence`: the launch-policy evidence covers a fork launch instead of `inherit_context: true`.
- `config-file`: `subagents.forkLaunch` replaces `subagents.forkedLaunch`; the old key is accepted with a warning for one minor release. The delta modifies "Optional field rules", which `remove-tool-assessment` (#89) introduced, so that change must be archived first.
- `settings-resolution`: the effective settings carry `subagents.forkLaunch`. The delta modifies "Effective settings resolver" from `remove-tool-assessment` (#89), which must be archived first.
- `worker-routing`: forks, not "launches that inherit context", ask fewer questions under `forkLaunch: thinking`.
- `worker-decision`: the untouched and thinking-only rules key on a fork launch and on `forkLaunch`.
- `tool-assessment`: dropped from this change after merging `main`. `remove-tool-assessment` (#89) removed the capability; a fork's tool limits now come only from the agent file and launch-policy adjustments.
- `executor-agent-registry` (`disallowed_tools`) and `executor-launch-policy` (adjustments): in a fork, removal means refusal at call time. Policy precedence for a fork's model and thinking is also defined.
- `subagent-run-facts`: a fork's tool and blocked counts use its callable tools; a fallback shows `fork → fresh`.
- `cli-review`: `jev_review` stays declared in a fork but is refused.

## Impact

**Code: executor (`packages/pi-subagents/src`)**
- `types.ts`, `config/custom-agents.ts`, `config/default-agents.ts`, `config/agent-types.ts`, `config/invocation-config.ts`: the `context` field, with `promptMode` and `inheritContext` removed.
- `session/prompts.ts`, `session/session-config.ts`, `session/context.ts`: the fresh prompt; `buildParentContext` removed.
- `lifecycle/create-subagent-session.ts`, `lifecycle/parent-snapshot.ts`, `lifecycle/subagent-session.ts`, `runtime.ts`: the fork session builder.
- `tools/agent-tool.ts`, `tools/spawn-config.ts`, `tools/foreground-runner.ts`, `tools/background-spawner.ts`.
- `service/service.ts`, `service/service-adapter.ts`.
- `seams/registry.ts`, `seams/launch-request.ts`, `seams/launch-gate.ts`, `seams/locked-launch.ts`.
- `ui/display.ts`, `ui/widget-renderer.ts`, `ui/session-navigation.ts`, `ui/session-navigator.ts`, `tools/result-renderer.ts`.

**Code: jev root (`src`)**
- `store/config.ts`, `store/settings.ts`, `store/settings-sections.ts`, `store/defaults.ts`.
- `policy/launch.ts`, `policy/worker/route.ts`, `host/worker/request.ts`, `host/worker/route.ts`, `host/platform/agents.ts`.

**Public APIs**
- The `subagent` tool parameter `context`.
- The agent frontmatter `context`.
- The service `spawn(..., { context })`.
- The config key `subagents.forkLaunch`.
- All with one-minor deprecation of the old names.

**Decisions**
- A new `packages/pi-subagents/docs/decisions/0014-subagent-context-is-fresh-or-fork.md` supersedes ADR 0008 and amends ADRs 0006 and 0010.

**Docs updated**
- `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md`, `packages/pi-subagents/VENDORED.md`, `packages/pi-subagents/CHANGELOG.md`.
- `docs/configuration.md`, `docs/usage-guide.md`, `docs/workflow.md`, `docs/jev-contract.md`, `docs/domain-model.md`.
- `docs/roadmap.md`, if it names the old settings.
- A new evidence document `docs/evidence/<date>-fork-cache.md`.
- Dated evidence documents under `docs/evidence/` stay unchanged as history.

**Dependencies**: none added.
