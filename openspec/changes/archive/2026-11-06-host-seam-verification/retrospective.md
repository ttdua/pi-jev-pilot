# Retrospective: host-seam-verification

## Wins

- All eight WG-02 questions have an answer from a real run. Q1 to Q7 are pinned by host tests that fail if Pi or the executor changes behavior, and Q8 has one recorded operator run.
- The harness under `tests/host/` (real Pi CLI in RPC mode, loopback recording provider, probe extensions) is reusable by WG-07 and WG-11.
- Each review round caught a real defect before it shipped: circular "assert against the report" scenarios, a leak assertion that could never fail, an environment leak to the CLI, and a Q5 test that could not tell "kept in history" from "never sent again".

## Misses

- The first Q5 compaction test measured the wrong request; it took a review round to add prompt 2 as the retention check.
- The first harness and Q8 versions passed the operator's whole environment to child processes; caught by review, fixed with an allow-list.
- The Q8 script was never run against a real provider before the operator's run, so its first run failed on a missing login (`USER` is needed by the `claude` CLI on macOS).

## Plan deviations

- Five internal contract changes (unmatched HTTP 400, `RpcProcess.pid`, `isolatedEnv`, `assertProbeReportClean`, the Q8 output additions), recorded in `plan.md` and `apply.md`.
- Two probe packages not in the plan (`envcheck`, `spawner`) support the isolation and descendant-kill tests.
- Tasks 5 to 8 ran in parallel in separate Worktrunk worktrees at the operator's request, then were cherry-picked in task order.

## Skill and workflow compliance

- Every task had a task review; three tasks needed fix rounds (Task 3: one, Task 7: one, Task 8: two, Task 9: two). The final whole-branch review led to one fix wave and a scoped re-review.
- The operator decided four questions through the Inbox during the run (fixture choice, `inherit_context`, worktree and branch cleanup), and a later answer superseded an earlier one on `inherit_context`.

## Surprises

- `Bun.sleep` is unavailable inside the Pi process; a probe using it hung `message_end`.
- `compact` refuses a short session ("Nothing to compact"); Q5 needs synthetic filler.
- A tool-call rewrite of `thinking` still applies when the agent file locks `model`.
- The OpenAI SDK retries HTTP 5xx, which double-counted unmatched fixture requests.

## Promote candidates

- Extract the repeated host-test helpers into `tests/host/support.ts` when WG-07 or WG-11 adds a second consumer.
- Rerun the Q8 script after each Pi or `pi-claude-code` upgrade, and once with a level the model clamps to exercise the `level-mismatch` branch.
- WG-11: decide whether fork launches keep the model and change only thinking (open option recorded in the roadmap).
