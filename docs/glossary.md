# Glossary

Use these words consistently in code, docs and the user interface.

## Jev and TypeSafe

| Term | Meaning |
|---|---|
| **Jev** | TypeSafe's decision model. It answers typed questions, and never generates text or acts. |
| **System One** | The class of model and the API (`POST /v1/systemone`) Jev is served through. |
| **State** | The material Jev reads for a request. One per request, shared by all its questions. |
| **Question** | A typed judgment asked about the state. Questions in a request are independent. |
| **Choice** | A question that selects one option and returns a probability for each. |
| **Noul** | A yes/no question answered with the probability of yes. Has no `confidence`. |
| **Criteria** | The description of each option of a choice, or of yes and no for a noul. |
| **Probability** | Jev's calibrated estimate for an answer. What this project decides on. |
| **Confidence** | A statistic derived from a choice's distribution. Depends on the number of options, so it is logged but never a gate. |

## Decisions

| Term | Meaning |
|---|---|
| **Decision** | What the policy concludes from Jev's answers. Jev answers; code decides. |
| **Policy** | The pure rules that turn answers into decisions. |
| **Rubric** | The set of descriptions that define the tiers in a question. Workers share one rubric in every mode; it has a version. |
| **Tier** | A role a model plays: `fast`, `balanced`, `deep`, `expert`. |
| **Slot** | A named custom model with a `when` description, offered beside the tiers. |
| **Mode** | The operator's cost preference: `budget`, `standard`, `premium`. A target table of tier shares, with a cap for `expert`. |
| **Directory mode** | A mode set for one directory with `/jev mode <m>`, stored in `<cwd>/.pi/jev-mode.json`. Every Pi run in that directory uses it in place of the global mode for worker routing. |
| **Difficulty score** | A number from 0 to 3.5 for one worker launch: the expected tier rank from Jev's `tier` probabilities, plus `effortRank / 8`. |
| **Cut point** | A score that separates two tiers, recomputed from recent ledger scores so the mode's target mix holds. |
| **Expert gate** | The condition for the `expert` tier: the score reaches the expert cut point and effort is `xhigh` or `max`. |
| **Effort** | How much reasoning a turn gets. Jev's ladder: `low` to `max`. |
| **Thinking level** | Pi's name for effort on a session or worker. |
| **Requested / effective** | The effort the policy wanted, and what the model supports after clamping. |
| **Clamp** | Reduce a level to the nearest one a model supports. |
| **Risk floor** | `risky > .7` raises effort to at least `high` and forces at least `deep`. |
| **Ceiling** | The highest level a turn or worker may start at: `xhigh`. |
| **Hold** | Keep the level of the latest decision until a compaction or a provider or model switch, on providers where changing it loses the prompt cache. |
| **Strategy** | How work should be carried out: `direct`, `delegate`, `parallel`, `graph`. Advice only. |
| **Advice** | Context attached for the model to weigh. Never enforced. |
| **Gate (skill)** | Three yes/no questions whose mean says whether a prompt needs a skill at all. |
| **Skill pick** | The one skill chosen for a prompt, or none. |
| **Catalog** | The skills Pi reports as available and readable. |
| **Inject / suggest** | Attach a skill's whole body, or only name it. |
| **Fallback** | Moving to a lower tier because the target cannot run. Happens before launch only. |
| **Fail open** | On any classifier failure, carry on as if unclassified. |
| **Miss** | A request that produced no usable answer: `timeout`, `error` or `schema`. |

## Workers

| Term | Meaning |
|---|---|
| **Main session** | The session the operator talks to. |
| **Worker** | A subagent. Runs in a child session. |
| **Child session** | A full Pi session in the same process, created by the executor. |
| **Executor** | The package that runs workers: the vendored `@ttdua/pi-subagents` in `packages/pi-subagents/`, derived from `@gotgenes/pi-subagents` ([ADR 0009](decisions/0009-vendored-executor.md)). |
| **Launch policy** | The one provider the executor consults for every new launch. jev-pilot registers it and answers with model, thinking, and tools to add or remove. |
| **Agent** | A worker's definition: built-in, or a Markdown file with frontmatter. |
| **Brief** | The prompt a worker is launched with. |
| **Launch** | One `subagent` tool call that starts a worker. |
| **Locked** | An agent file field a caller cannot override. |
| **Declared tools** | The `tools` list in an agent file. Treated as a contract. |
| **Disallowed tools** | The `disallowed_tools` list in an agent file. Never added, and wins over a grant. |
| **Tool assessment** | Jev scoring a launch's undecided tools, at launch. |
| **Block candidate** | A tool the worker would have by default, asked as `tool::<name>`. |
| **Grant** | A tool the worker would not have, added because Jev scored `grant::<name>` at `tools.grantAt` or more. |
| **Observe / enforce** | Record what assessment would block or grant, or actually apply it. |

## Records and control

| Term | Meaning |
|---|---|
| **Ledger** | The local file of decisions and outcomes. Never holds prompt text. |
| **Correction** | A prompt Jev reads as saying the previous turn was wrong. Marks that turn. |
| **Tally** | Per-session counts of prompts, workers, worker tokens and fallbacks, shown by `/jev`. |
| **Log line** | One `jev-log` entry shown in the conversation while `verbose` is on. Labels and numbers only, never sent to the model. |
| **Switch** | A feature's live on/off state. |
| **Tuning** | Automatic, bounded adjustment of allowlisted parameters. |
| **Signal** | A measure tuning watches, such as the share of unanswered requests. |
| **Cooldown** | The minimum number of decisions between two tuning changes. |
| **Revert** | Tuning undoing its own change when results worsen. |
| **Replay** | Sending saved prompts through Jev offline to measure a change. Costs money and sends data, so it needs approval. |

## People

| Term | Meaning |
|---|---|
| **Operator** | The person running Pi with this package. |
| **Upstream** | [jev-pilot](https://github.com/Akramovic1/jev-pilot) 0.12.1, the Claude Code plugin this adapts. |
| **Port** | [naicoi92/pi-jev-pilot](https://github.com/naicoi92/pi-jev-pilot), the earlier Pi adaptation this replaces. |
