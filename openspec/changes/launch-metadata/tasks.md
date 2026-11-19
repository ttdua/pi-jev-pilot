## 1. Metadata validation and child-session registry seams

Blocked by: none

- [x] 1.1 Add `src/seams/launch-metadata.ts` with `parseLaunchMetadata(input)`: plain-object check, only enumerable string keys, 32-key limit, key pattern, string values of at most 1024 characters; returns a frozen null-prototype copy, or `undefined` for `undefined` or an empty map; throws an `Error` naming the rule and the offending key (design D2)
- [x] 1.2 Add `test/seams/launch-metadata.test.ts` covering every limit scenario in `specs/launch-metadata` ("Metadata limits"), the empty-map case and the copy/freeze behavior
- [x] 1.3 Declare the public `LaunchMetadata` and `ChildSessionInfo` types in `src/service/service.ts` (the seams return them), then add `src/seams/child-sessions.ts`: a process-wide registry on `globalThis[Symbol.for("@ttdua/pi-subagents:child-sessions")]` with `enterChildSession`, `leaveChildSession`, `lookupChildSession` (frozen entry, shared frozen empty `metadata`) and a test-only `resetChildSessions` (design D3)
- [x] 1.4 Add `test/seams/child-sessions.test.ts`: entry shape and freezing, unknown id, removal, two module instances sharing one registry

## 2. Carry metadata through the launch path, events, record and policy request

Blocked by: 1

- [x] 2.1 Add the public fields in `src/service/service.ts`: `SpawnOptions.metadata`, `SubagentRecord.metadata`, `LaunchRequest.metadata` and `SubagentsService.childSession`; add `metadata` to `PublishedLaunchIdentity`/`LaunchSource`/`launchIdentity` in `src/seams/identity.ts` plus a `launchFields(record)` helper for record events
- [x] 2.2 `src/service/service-adapter.ts`: call `parseLaunchMetadata` at the top of `spawn()`, pass `metadata` on the spawn config, copy it in `toSubagentRecord`, implement `childSession` over the registry
- [x] 2.3 `src/lifecycle/subagent-manager.ts` and `src/lifecycle/subagent.ts`: `AgentSpawnConfig.metadata` → execution config → `Subagent.metadata`; pass it to `createSubagentSession` params and to the launch gate
- [x] 2.4 `src/lifecycle/create-subagent-session.ts` and `src/lifecycle/child-lifecycle.ts`: include `metadata` in the launch identity; the publisher enters the registry before emitting `session-created` and leaves it after emitting `disposed`
- [x] 2.5 `src/seams/launch-gate.ts` and `src/seams/launch-request.ts`: carry `metadata` into the frozen `LaunchRequest` only when present
- [x] 2.6 `src/observation/subagent-events-observer.ts`: record events add `metadata` from the record next to `toolCallId`; leave `src/persisted-record.ts` unchanged
- [x] 2.7 Add `test/seams/launch-metadata-flow.test.ts` driving real boundaries (adapter → manager → `createSubagentSession` → publisher/observer) for the child event, record event, snapshot, queued, resume, refusal-creates-nothing, policy request, persisted entry, lookup lifetime (session_start, shutdown, dispatch, disposal, failed bind, failed grant check, parent shutdown) and shared-registry scenarios, plus a type-level check that `ResumeOptions` has no `metadata`
- [x] 2.8 Run `bun run test:executor` and update any existing test whose exact-payload expectation now needs to tolerate the absent field (none expected, since the field is omitted when absent)

## 3. Records, generated types and docs

Blocked by: 2

- [ ] 3.1 Add `VENDORED.md` rows for the new seam and test files and for every edited upstream file, with one-line reasons
- [ ] 3.2 Regenerate `dist/public.d.ts` with `bun run --cwd packages/pi-subagents build:types` and run `verify:public-types`
- [ ] 3.3 Update `packages/pi-subagents/README.md`: `spawn` contract (metadata, limits, refusal, not for secrets), the Events table (metadata on record events), the child lifecycle events (metadata on `spawning`, `session-created`, `bound`) and a new `childSession` contract with its shutdown bound; add `test/readme-contract.test.ts` asserting the visibility and no-secrets sentence
- [ ] 3.4 Update `docs/architecture.md` (seams line) and `docs/decisions/0009-vendored-executor.md` (seam list) to name launch metadata and the child-session lookup
- [ ] 3.5 Run `bun run test`, `bun run test:executor`, `bun run lint`, `bun run typecheck` and the vendoring test; all pass
