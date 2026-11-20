## Context

`src/` already talks to the executor only through `import type` from `@ttdua/pi-subagents`, the service slot `Symbol.for("@gotgenes/pi-subagents:service")` and `subagents:*` events. `ttdua/pi-subagents` `v0.1.1` keeps that slot name, the event names, `implementation: "@ttdua/pi-subagents"` and the public types (`dist/public.d.ts`). The remaining coupling is in:

- `src/host/platform/service.ts`: `isVendoredService` accepts only `implementation === "@ttdua/pi-subagents"` with `listAgents`; the type `VendoredService` carries that literal.
- `src/host/platform/readiness.ts`: `VENDORED_DIR`, `isOtherService`, `isUsableCapture` and the `duplicate` state.
- `src/host/commands/status-format.ts`: the duplicate line advising to uninstall `@gotgenes/pi-subagents`.
- `tsconfig.json` `paths` to `packages/pi-subagents/dist/public.d.ts`; `.oxlintrc.json` and `tests/support/import-graph.ts` exempt `packages/`.
- The host harness's `executor-only` install mode and fixture, and the `checkout` mode that brings the executor through the root manifest.

Checked during design: `bun add -d "@ttdua/pi-subagents@github:ttdua/pi-subagents#v0.1.1"` installs the package with `dist/public.d.ts` (exports `registerLaunchPolicy`, `listAgentTypes`), and `pi install <node_modules path>` with `PI_OFFLINE=1` succeeds.

## Goals / Non-Goals

**Goals:**
- jev-pilot builds, type-checks and runs its host tests without `packages/`.
- One executor version for types and host tests, pinned and reviewable.
- Routing decided by what the published service offers.

**Non-Goals:**
- Changing executor code, events or the service slot name.
- Changing Jev requests, routing decisions or the ledger schema.
- Supporting two executors at once (Pi refuses two `subagent` tools).

## Decisions

### D1. Executor capabilities, read from the published service

A pure function in `src/host/platform/` reads the value in the executor slot and returns:

```
ExecutorState =
  | { kind: "absent" }                          // no subagent tool and no service
  | { kind: "present", implementation?: string, // service.implementation when a non-empty string (raw value is unknown)
      launchPolicy: boolean,                    // typeof registerLaunchPolicy === "function"
      agentRegistry: boolean }                  // typeof listAgentTypes === "function"
```

`buildSnapshot` keeps its optional `executor` input: the live path (`loadSnapshot`) always passes `executorState(...)`; pure callers that pass only tool names get `present` with both capabilities when `subagent` is listed, so existing pure tests keep their meaning. `present` needs the `subagent` tool in `pi.getAllTools()` or a service object in the slot. Routing requires `launchPolicy`; the agent list requires `agentRegistry`. The capture at `session_start` keeps any object service (not only ours), so routing and agent facts read it the same way.

Why not keep the name check: it shuts out compatible executors, and the original executor is already excluded by its missing launch policy. Why not detect by tool `sourceInfo` path: install paths are not a contract.

`VendoredService` is renamed `ExecutorService` and typed as `Partial<Pick<SubagentsService, "registerLaunchPolicy" | "listAgentTypes">> & { readonly implementation?: unknown }`; call sites check the method before calling, as `Registration.register` already does.

### D2. Status wording

`/jev` reports one executor line (exact strings in the `jev-command` delta):
- `executor: no executor; worker routing is off` (keeps the existing `no executor` text)
- `executor: <implementation or "unknown">` when routing can run
- `executor: <implementation>; no launch policy, worker routing is off` when the policy capability is missing
- `; no agent registry` appended when `listAgentTypes` is missing.

The `mix` line shows only when routing can run (as with `present` today). The status line above the editor is unchanged: it never showed the executor.

### D3. Executor source for types and host tests

`package.json` `devDependencies` gains `"@ttdua/pi-subagents": "github:ttdua/pi-subagents#v0.1.1"`; `bun.lock` pins its commit. `tsconfig.json` drops `paths`; the package's `exports.types` resolves the declarations. The harness resolves the executor directory once from `node_modules/@ttdua/pi-subagents` and installs it with `pi install <dir>` before jev-pilot, so extension order matches a user install. Install modes become `jev` (jev-pilot only), `jev+executor` (default) and `none`; the root package installs only jev-pilot, so `checkout` and `jev-only` collapse into `jev`.

Why not a submodule or an env var: two sources for one version and an extra setup step. Why not `pi install git:` in tests: network, breaks `PI_OFFLINE=1`.

### D4. Test removal rule

A test or requirement whose Pi session installs only the executor is removed. Tests where jev-pilot's extension runs stay and use the pinned executor. Probe-only sessions (`none`, used by Q5/Q6, which test Pi itself) stay. `duplicate-executor.test.ts` goes with the `duplicate` state; the original-executor scenarios of `readiness-checks` and `jev-command` are covered by unit tests over a fake slot holding a service shaped like `@gotgenes/pi-subagents` 25.0.5 (no `implementation`, `listAgents` only), and "Both executors installed" is Pi behavior, recorded but not host-tested. Q4 (child session detection) is still needed by `child-registry`; its host test moves from `q3-q4-child.test.ts` to a jev-pilot session (`tests/host/q4-child.test.ts`, keeping the `"WG-02 Q4"` marker), and Q3 is marked moved to the executor repository in the evidence report.

### D5. Runtime-import rule kept, re-scoped

The rule moves from `executor-vendoring` to a new capability `executor-boundary`, so the vendoring capability is removed in full and its stale Purpose goes with it. The same capability keeps the old-name docs guard (`twin`, `prompt_mode`, `inherit_context`) for jev-pilot's own `docs/`, previously part of `subagent-context-mode`. Archive applies a delta that removes every requirement of a capability; the task list checks the 13 emptied spec folders are gone after archive. The import-graph test keeps rejecting value imports of `@ttdua/pi-subagents` from `src/`, and drops the `packages/` path exemption and fixtures. `.oxlintrc.json` drops `packages/**`.

### D6. Decision record

A new ADR `0010-executor-as-installed-package.md` supersedes 0009: executor in its own repository, capability detection, pinned dev dependency for tests. 0009 is marked superseded.

### D7. Version

`0.6.0` (pre-1.0 minor bump for a breaking install change), package name `@ttdua/pi-jev-pilot`. The changelog entry has a migration note: install `git:github.com/ttdua/pi-subagents@v0.1.1`.

### D8. Deviations from brainstorm

`brainstorm.md` lists `agent-metadata` and `release-metadata` as unchanged. Writing the deltas showed both need edits: `agent-metadata` (and `main-state`, `cli-review`) cited specs this change removes, so their references now point to `ttdua/pi-subagents` (wording only; `main-state` also skips agents without an agent registry, per D1); `release-metadata` gains the executor install line, so the README cannot drift from the pin. A new capability `executor-boundary` holds the runtime-import rule and the old-names docs guard (D5). Scope and approach are unchanged.

## Risks / Trade-offs

- [Users upgrade jev-pilot and lose worker routing silently] → `/jev` says `executor: no executor; worker routing is off`; README and changelog lead with the second install.
- [Executor contract drifts from the pin] → only a pin bump changes it; host tests run against the pin; the type check fails on removed members.
- [A third-party executor offers `registerLaunchPolicy` with different semantics] → accepted: capability means "speaks this contract"; policy calls stay fail-open with the existing timeout.
- [`pi install` from `node_modules` installs the executor's dev files] → test-only; isolated agent directory.
- [Git dependency needs network on first `bun install`] → same as other dev dependencies; CI already installs with network; host tests themselves stay offline.

## Migration Plan

1. Release `ttdua/pi-subagents` `v0.1.1` (done).
2. Merge this change; tag `v0.6.0`.
3. Users: `pi install git:github.com/ttdua/pi-subagents@v0.1.1`, then update jev-pilot to `@v0.6.0`.
4. Rollback: reinstall jev-pilot `@v0.5.0` (vendored executor) after removing the separate executor install, since Pi refuses two `subagent` tools.

## Open Questions

None. The brainstorm's open question is settled by D2: the line names the implementation when the service reports one.
