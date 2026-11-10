## Context

jev-pilot is one Pi extension that runs twice in a process: once in the main session and once in each worker (child) session. Today it drives `@gotgenes/pi-subagents@25.0.5`, installed separately, through these seams:

- `message_end`: classify sibling `subagent` calls before their `tool_call` handlers run (WG-02 Q2).
- `tool_call`: rewrite `event.input.model` and `thinking` (Q1).
- `tool_result.details.agentId` plus `subagents:completed|failed|resumed`: join a launch to its outcome.
- `subagents:child:session-created|disposed`: a process-wide registry of child session ids (Q4).
- Child `before_agent_start`: remove tools from `systemPromptOptions.selectedTools` (Q3) and find the worker's record with `listAgents()` matched by `outputFile`.
- `src/host/platform/agents.ts`: re-parse agent files and keep a built-in agent table.

Facts from the executor source that shape this design:

- `SubagentsService.spawn()` returns the agent id synchronously; `SubagentManager.create()` builds a `Subagent` record, then starts or queues it. Session assembly (`createSubagentSession`) is async and runs when the record starts, after the concurrency queue.
- The tool door (`AgentTool.execute`) resolves caller and agent-file values with `resolveSpawnConfig`, honoring `locked`; the service door passes options straight to the manager. Only the tool door has a `toolCallId`.
- A child's tools are an allowlist (`toolNames`), with `EXCLUDED_TOOL_NAMES` as a denylist. Every non-excluded parent extension is bound in the child, so naming an extension tool in the allowlist is enough to grant it. Built-ins such as `codemode` load through `builtinExtensionsFor(toolNames)`.
- Omitting `tools` gives the seven built-ins and no extension tools.
- The executor has no tool denylist field in agent frontmatter; upstream moved that to `@gotgenes/pi-permission-system`.
- The executor has no runtime `dependencies`; its peers are `pi-ai`, `pi-coding-agent`, `pi-tui` and `typebox`. It uses `#src/*` subpath imports, pnpm, vitest, biome and eslint.
- `@gotgenes/pi-subagents-worktrees` consumes the service through `Symbol.for("@gotgenes/pi-subagents:service")` and `registerWorkspaceProvider`.

## Goals / Non-Goals

**Goals:**
- Vendor the executor so seams and their consumer land, and are tested, together.
- Replace every heuristic join with identifiers the executor supplies.
- One launch policy seam for every launch path, replacing `message_end` batching and `tool_call` mutation.
- Tool grants and blocks at launch, bounded by the agent author's `tools` and `disallowed_tools`.
- Keep the vendored package mergeable with upstream.

**Non-Goals:**
- Upstream pull requests.
- Supporting the original `@gotgenes/pi-subagents` in jev-pilot.
- Changing worker difficulty scoring, tiers, modes or main-session decisions.
- Reading `@gotgenes/pi-permission-system` frontmatter.

## Decisions

### D1. Vendored layout and install

`packages/pi-subagents/` holds the executor, as a Bun workspace member listed in the root `package.json` `workspaces`. The root `pi.extensions` lists `./packages/pi-subagents/src/index.ts` first, then `./src/extension.ts`, so `pi install` of this repository loads both, the executor publishes its service when it loads (unless a vendored service already holds the slot, so a child's instance never replaces the main one), and jev-pilot captures it at `session_start` and registers the policy. Publishing at load, as upstream does, keeps load-time consumers such as `@gotgenes/pi-subagents-worktrees` working (operator decision during apply). Pi awaits `session_start` handlers in extension order. The vendored `package.json` keeps its `imports` map so `#src/*` resolves against it.

- *Why not a second Pi package installed separately:* one install is what the operator chose, and `pi install` of a repository subdirectory is unverified.
- *Why not merging the executor into `src/`:* every upstream merge would become a rewrite.

The root peer dependencies grow to the union the two extensions import (`@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`). There are still no runtime `dependencies`.

### D2. Upstream sync with `git subtree --squash`

Upstream is a monorepo (`gotgenes/pi-packages`, `packages/pi-subagents`). Sync is done by running `git subtree split --prefix packages/pi-subagents` in a clone of upstream at a release tag, then `git subtree add|pull --prefix packages/pi-subagents <split> --squash` here. `packages/pi-subagents/VENDORED.md` records the upstream tag and commit, and lists every local seam with its files.

The starting point is the `@gotgenes/pi-subagents` 25.0.5 release, the version the host tests already verify.

- *Why `--squash`:* it keeps this repository's history readable; the upstream commit is recorded instead.
- *Why not a git submodule:* local seams have to be committed somewhere, and a submodule would need its own fork repository.

### D3. Seams live in new files; existing files get thin call sites

Each seam is a new module under `packages/pi-subagents/src/seams/` (identity, effective launch, registry snapshot, launch policy, tool resolution). Existing upstream files change only at call sites. This keeps merge conflicts small and lets `VENDORED.md` list the touched upstream files.

### D4. Keep the executor's public identity

The service key `Symbol.for("@gotgenes/pi-subagents:service")`, the `subagents:*` event names, and the `subagent` tool name stay unchanged. New fields and methods are additive.

- *Why:* `@gotgenes/pi-subagents-worktrees` and `@gotgenes/pi-permission-system` keep working, and upstream merges stay mechanical.
- *Cost:* the vendored and the original executor cannot both run cleanly. D10 detects that case.

The vendored workspace is renamed (`@ttdua/pi-subagents`, `private: true`), so it cannot be confused with the published package in `node_modules`.

### D5. Launch identity and effective launch facts (public contract)

- `subagents:child:spawning`, `session-created` and `bound` gain `agentId` and `agentType`, plus `toolCallId` when the launch came from a tool call.
- `subagents:created`, `started`, `completed`, `failed`, `resuming` and `resumed` gain `toolCallId` when present.
- `session-created` and `SubagentRecord` gain `effectiveModel` (`provider/id`) and `effectiveThinking`. These are the values the child session was actually created with, after `locked`, the launch policy and resolution.

`SubagentRecord` additions follow upstream ADR 0005's admission rules (serializable, optional). The full shapes go in plan.md Contracts.

### D6. Agent registry query (public contract)

`SubagentsService` gains `listAgentTypes()` and `getAgentType(name)`. They return frozen, serializable snapshots of what the executor resolves: `name`, `source` (`builtin`, `global`, `project`), `description`, `instructions` (body), declared `tools` (or `null`), `disallowedTools`, `model`, `thinking`, `locked`, `maxTurns`, `runInBackground`, `inheritContext` and `enabled`. `getAgentType` resolves names exactly as a launch does (case-insensitive fallback, `general-purpose` default), and both reload agent files first, as the tool door does.

jev-pilot keeps its rule never to send an agent's model or thinking to Jev; it maps the snapshot to its existing `AgentFacts` with `sets` booleans.

### D7. `disallowed_tools` frontmatter

The field takes the same forms as `tools` (list, comma string). The executor removes the named tools after every other source (agent `tools`, defaults, policy grants) and before the recursion denylist. A name in both `tools` and `disallowed_tools` resolves as disallowed, and the executor emits a debug note.

### D8. Launch policy provider (public contract)

`SubagentsService.registerLaunchPolicy(policy, { timeoutMs })` returns an unregister function. Only one policy can be registered: a second registration throws until the first unregisters. Upstream ADR 0002 rations provider seams; one slot keeps ordering trivial.

- **Where it runs:** in the record's start path, after dequeue and before `createSubagentSession`. It runs for every new launch from either door. It does not run for `resume`, which creates no session. Background `spawn()` still returns its id at once.
- **Input (`LaunchRequest`):**
  - `agentId`, resolved `agentType` and the D6 snapshot.
  - `origin`: `{ kind: "tool", toolCallId }` or `{ kind: "service" }`.
  - `parentSessionId`.
  - `prompt` and `description`.
  - `requested`: the caller's `model` and `thinking`, after `locked` was applied.
  - `locked` fields, `inheritContext` and `isBackground`.
  - `toolSet`: the agent's declared `tools` (or `null`), `disallowedTools`, the default set the child would get, and the parent session's tool names, minus the executor's own non-grantable tools (`subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent`, `notify_parent`).
- **Output (`LaunchAdjustment | undefined`):** optional `model`, `thinking`, `addTools` and `removeTools`.
- **Precedence, enforced by the executor:**
  - `locked` model and thinking cannot be changed by the policy.
  - Declared `tools` cannot be removed.
  - `disallowedTools` cannot be added.
  - Added tools must come from the parent's tool names.
  - Violating entries are dropped with a debug note; the rest applies.
  - Policy values override the caller's requested values.
- After the child binds its extensions, the executor drops grants the child did not actually register and reports the rest as `grantedTools` on `subagents:child:bound`. A parent tool list cannot prove a child will have a tool (an extension may register tools only in the main session, or later).
- **Fail open:** if the policy throws, rejects, returns a malformed value or exceeds `timeoutMs`, the launch proceeds unchanged. The executor aborts the signal it passed to the policy.

- *Why not keep `tool_call` mutation:* it cannot see `spawn()`, it depends on handler ordering (Q2), and it cannot touch tools.
- *Why at start rather than at the door:* `spawn()` is synchronous, and the policy is async (it calls Jev).

### D9. jev-pilot as the policy consumer

The main-session instance registers the policy when the service is captured at `session_start` and unregisters it at `session_shutdown`. The policy's watchdog timeout is a fixed 10 s; each call bounds its Jev requests by `classifier.timeoutMs` read fresh, so tuning applies without re-registering.

**Routing decision**, inside the policy:
- `parentSessionId` belongs to a child session: return `undefined`.
- `origin.kind === "service"` and `requested.model` is set: model untouched, thinking still decided, as for an agent file that locks only the model.
- Otherwise, run the existing worker decision unchanged and map its route to `model` and `thinking`.
- The `subagents.forkedLaunch` setting applies to `inheritContext` launches as today.

**Tool decision**, in the same call:
- Undecided tools are `(default set ∪ parent tools) − declared tools − disallowedTools − never-candidates`. Never-candidates are `jev_review` and the executor's non-grantable tools.
- At most 32 in total are scored, block candidates first.
- Jev and tool assessment run concurrently, bounded by one classifier timeout.
- Removing tools from a child no longer goes through `before_agent_start`. The child handler that hides `jev_review` stays, as a guard for an agent that names it in `tools`.

**Removed:** the `message_end` batching, the `tool_call` mutation and stamping, the `tool_result` agent-id join, the `outputFile` lookup and `src/host/platform/agents.ts`. Outcome joins use `agentId` from the D5 events.

### D10. Executor presence and duplicates

- **Present:** the published service at the key has `registerLaunchPolicy`.
- **Duplicate:** checked after bind in the main session, from the winning `subagent` tool's `sourceInfo` (original loaded first) and the published service's `implementation` (original loaded last). Pi keeps only the first registration of a name and does not expose extension paths to extensions, so a provider that loses both races is not detectable; the docs say so. The vendored service is published at load only when the slot holds no vendored service, and unpublishes only itself, so children never replace or remove it. This is reported in `/jev` as a problem naming the original package, and routing stays off until it is removed.
- **No executor:** behaves as today: worker features off with a note in `/jev`.

### D11. Tool question and thresholds

Today's question, `tool::<name>`, asks whether a tool is "dangerous or clearly inappropriate" and flags it at 0.5 or more. That reading suits blocking but not granting: "not dangerous" does not mean "needed". The candidate's starting state decides which question it gets:

- **Default tool** (the child would have it): keep `tool::<name>` unchanged. It is blocked at 0.5 or more, as today.
- **Grant candidate** (the child would not have it): a new noul, `grant::<name>`, asks whether the task needs the tool to be done well. It is granted at `tools.grantAt` or more, a new setting with default `0.8`.

The worker rubric version (`RUBRIC_VERSION`, 2) is **not** raised: it versions only the worker `tier` wording and gates the cut-point window (`mode-cutpoints`), so raising it for a tool question would empty every window for no reason. Observe mode (the default) records would-block and would-grant counts and changes nothing. Enforce applies both. `docs/jev-questions.md` holds the new wording.

- *Why not one "is it needed?" question for both:* it would silently change the meaning and calibration of the existing block decision, and the observe data collected so far would no longer be comparable.
- *Why a high grant cut:* granting widens what a worker can do, so a false positive costs more than a missed grant.

### D12. Ledger fields

The worker line gains:
- `effectiveModel` and `effectiveThinking`, joined from the D5 event by `agentId`.
- `toolsGranted`, the count of granted tools.
- `toolsFlagged` keeps its meaning (blocked or would-block).

They join the existing per-launch line rather than a new kind; the line stays one per launch. The schema change is additive; older lines remain valid.

### D13. Toolchains and CI

The vendored package is run with Bun as package manager (`bun install` at the root), with its own `vitest` tests run by `bun run --cwd packages/pi-subagents test`. Its own `check` (tsc) and biome lint configs are kept as vendored. Its `lint` script stops calling `pnpm`; this is a one-line local edit recorded in `VENDORED.md`.

The root `test` stays jev-pilot's Bun suite. A root `test:executor` script and the CI workflow run both suites. jev-pilot's import-graph test, function-size lint and `tsc` exclude `packages/`. jev-pilot code may `import type` from `@ttdua/pi-subagents`, but never import it at runtime: the two extensions are separate module instances.

The `pnpm-lock.yaml` from upstream is not vendored; the root `bun.lock` covers the workspace.

### D14. Host tests

Host tests install this repository with `pi install` into the isolated agent dir, which installs both extensions, instead of the pinned devDependency.

- Q1 and Q7 tests are retired, and their evidence entries marked superseded with a link to the new tests.
- The Q2 test is retired; batching no longer exists.
- Q3 stays: the child guard that hides `jev_review` still uses `selectedTools`. Q4 stays.

New host tests cover:
- Policy routing for tool and service launches.
- A locked model untouched.
- Policy timeout falls open.
- Tool grant reaches the child's first request, and `disallowed_tools` wins.
- Effective model in the ledger.
- Duplicate-executor detection.

## Risks / Trade-offs

- **[Upstream drift makes merges painful]** → Seams in new files (D3); call-site edits listed in `VENDORED.md`. The vendored package keeps its own unit tests, so a merge that breaks a seam fails in CI.
- **[Pi's loader may not resolve `#src/*` imports for a nested extension path]** → The first task is a package-loading host test of both extensions from one install. If it fails, fall back to relative imports via a mechanical rewrite recorded in `VENDORED.md`.
- **[Users still have the original executor installed]** → D10 detection and a `/jev` problem line; usage guide and CHANGELOG mark the breaking change.
- **[Granting extension tools widens what a worker can do]** → Only tools the parent session already has, never `disallowed_tools`, never the executor's own orchestration tools. Enforce stays off by default.
- **[Policy latency now applies to service spawns and queued launches]** → Same classifier timeout as today. A queued launch is classified at dequeue, so its brief is unchanged and nothing goes stale.
- **[Two module instances]** → jev-pilot uses the executor only through the service and events, and `import type` only. Covered by a test that the bundle graph has no runtime import of `packages/`.
- **[Retiring Q1–Q3 evidence loses history]** → Evidence entries are marked superseded, not deleted.
- **[One policy slot blocks a second consumer]** → Acceptable; there is one consumer. A second registration fails loudly rather than silently overriding.

## Migration Plan

1. Vendor the executor at 25.0.5 unchanged and switch the install and host tests to it. Behavior is identical; this is the checkpoint for loader and CI risks.
2. Add the executor seams (D5–D8) with unit tests in the vendored package.
3. Move jev-pilot onto the seams (D9–D12) and remove the old seam code.
4. Update docs, ADR (superseding 0006) and evidence; release with a breaking-change note: uninstall `@gotgenes/pi-subagents` before updating.

**Rollback:** reinstall the previous jev-pilot tag and `@gotgenes/pi-subagents@25.0.5`; ledger lines with the new fields stay readable, since the schema change is additive.

## Open Questions

- The exact default for `tools.grantAt` (0.8 proposed) will be checked against a replay before enforce is recommended. It does not block the change, because observe is the default.
