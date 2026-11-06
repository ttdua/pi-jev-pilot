## 1. Setting

- [x] 1.1 Add `subagents.forkedLaunch` (`untouched` | `thinking`) to `src/store/config.ts` validation and `Config`, its default `untouched` to `src/store/defaults.ts`, and `settings.subagents.forkedLaunch` to `src/store/settings.ts` (config-file: Other field rules; settings-resolution: One resolver for effective settings)

## 2. Pure route

- [x] 2.1 Add `supportedLevels` and `clampLevel` in `src/policy/effort.ts`, with a parity test against pi-ai's `getSupportedThinkingLevels` and `clampThinkingLevel` in `tests/policy/` (Supported thinking levels, Thinking clamp)
- [x] 2.2 Add `launchKind` and `routeLaunch` in `src/policy/route.ts`, built on `decideTier`, `chooseFallback` and `workerEffort` (Route result, Launches left untouched, Route on Jev failure, Route writes thinking only, Routed launch, Nothing can run, Locks in the route)

## 3. Host routing

- [x] 3.1 Add `src/host/worker.ts` request side: gate from `loadSnapshot` and the child registry, `message_end` batch over `subagent` calls (agent read, `launchKind`, state and questions with registry display names and optional parent request, concurrent `askJev` with `ctx.signal`), bounded cache by tool call id (When routing runs, Sibling launches classified together, Worker request content)
- [x] 3.2 Add the `tool_call` side: classify a launch without a cached result, check offered tiers with `ctx.modelRegistry.find` and `hasConfiguredAuth`, call `routeLaunch`, mutate `input.model` and `input.thinking`, catch every error (Launches without a cached result, Target check before writing, Input mutation, Routing fails open)
- [x] 3.3 Add fallback warnings with once-per-tier-and-model dedupe, cleared when `/jev` runs (Fallback warning)
- [x] 3.4 Wire `src/host/worker.ts` into `src/host/setup.ts`, unsubscribing on `session_shutdown` and clearing shown warnings when `/jev` runs

## 4. Ledger

- [x] 4.1 Build the worker ledger draft from the route and request, and join it to the executor outcome through `tool_result.details.agentId` and `subagents:completed`, `subagents:failed`, `subagents:resumed` in either order; refused launches written as `error` (One line per launch, Outcome joined from the executor, Decision fields, Caller model field, Ledger failures do not affect the launch)

## 5. Host tests

- [x] 5.1 Extend `tests/host/fixture.ts` (function replies, a provider without credentials). Host test with a loopback Jev fixture and the real executor: foreground and background launches run on the routed model and thinking; `resume` untouched; forked launch under both `forkedLaunch` values; Jev timeout and HTTP 500 leave input unchanged; switch off and no key send nothing
- [x] 5.2 Host test: unusable `deep` (no credentials) cascades to `balanced` with one warning for two launches; ledger lines carry `fallback`, outcome fields, and no prompt marker
- [x] 5.3 Host test: a nested `subagent` call through a tool that uses `ctx.executeTool` is classified at its `tool_call`

## 6. Docs

- [x] 6.1 Update `docs/domain-model.md`, `docs/jev-contract.md`, `docs/usage-guide.md` and `docs/workflow.md` for forked and thinking-only launches and the ledger `reason`; `docs/configuration.md` for `subagents.forkedLaunch`; `docs/architecture.md` module layout; `docs/roadmap.md` WG-11 and WG-13
- [x] 6.2 Draft the issue #14 (WG-13) body without the tier cascade, for the operator to approve before posting
- [x] 6.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass
