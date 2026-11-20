# Task 2 report (written by controller)

The implementer subagent (6b79b5d1) lost its upstream connection after committing e823f63b and before writing this report. The controller reconstructed the evidence from the committed tree; it has no RED evidence.

## Commit
e823f63b feat(readiness-checks): detect the executor by capability (14 files, +212 −196)

## Verification run by controller (after the commit)
- `bun run typecheck`: no type errors in 292 files
- `bun run lint`: clean; `bun run fmt:check`: clean
- `bun test tests/host/platform`: 91 pass, 0 fail
- `bun test tests/host/worker/policy.test.ts tests/host/worker/warnings.test.ts tests/host/worker/cutpoint-window.test.ts`: 78 pass, 0 fail
- `bun test tests/host/commands`: 233 pass, 0 fail
- `bun test tests/jev`: 194 pass, 0 fail
- `bun test tests/host/status`: 82 pass, 0 fail
- `tests/host/worker-routing.test.ts` (real Pi CLI host test, Task 3 scope) times out: expected until the harness installs the executor (Task 3).

## Gaps
- No TDD RED evidence (lost with the session).
- No self-review or contract-deviation notes from the implementer. The controller checked `plan.md` and found it unchanged in e823f63b.

## Fix round 1

**Changed**
- `readiness.ts`: `executorState` decides on a non-null object service; `absent` only with no `subagent` tool and no object; capabilities read only from that object (functions/non-objects → both false).
- `service.ts`: `captureMainService` guards the slot read; a throwing getter clears the old capture.
- `routing.ts`: `Registration.register` reads `registerLaunchPolicy` inside a guard; a throw means no policy (slot not taken); called with the service as receiver.

**RED** — `bun test tests/host/platform tests/host/worker/policy.test.ts`: 4 fail (service-only present, non-object service, throwing slot getter, throwing capability getter; each `expect(...).not.toThrow()` / `toEqual` mismatch).

**GREEN** — `bun test tests/host/platform tests/host/worker/policy.test.ts tests/host/worker/warnings.test.ts tests/host/worker/cutpoint-window.test.ts tests/host/commands tests/jev tests/host/status`: 682 pass, 0 fail. typecheck, lint, fmt:check clean.

**Files** — src/host/platform/{readiness,service}.ts, src/host/worker/routing.ts, tests/host/platform/{readiness,service}.test.ts, tests/host/worker/policy.test.ts.
