# Scenarios

What each scenario changes for you, when it applies, and which rule wins.

| Scenario | You no longer | Section |
|---|---|---|
| Thinking level | Change `/thinking` before each prompt | [Your thinking level follows the prompt](#your-thinking-level-follows-the-prompt) |
| Worker models | Pick a model for each worker | [Workers get a model and effort for you](#workers-get-a-model-and-effort-for-you) |
| Reviews | Route reviews by hand | [Reviews go to your reviewer model](#reviews-go-to-your-reviewer-model) |
| Rules | Guess which setting applies | [Which rule wins](#which-rule-wins) |

## Your thinking level follows the prompt

**When it applies.** You send a prompt in the main session.

**What you do.** Nothing. Leave `/thinking` where it is, or change it yourself at any time.

**What the package decides.** The thinking level for that prompt. It picks a level from Jev's answer, raises risky work to at least `high`, caps the start at `xhigh`, and leaves a current `max` alone ([rules](domain-model.md#maindecision)).

## Workers get a model and effort for you

**When it applies.** A prompt launches a `subagent` worker.

**What you do.** Set a mode for this directory with `/jev mode budget|standard|premium`. Add `global` (`/jev mode <m> global`) to set it for every directory without its own mode, and `/jev mode clear` removes the directory mode ([usage guide](usage-guide.md#modes)).

**What the package decides.** The model tier and thinking level of each launch, so one command shifts the whole tier mix.

## Reviews go to your reviewer model

**When it applies.** You configured a `reviewer` slot in `config.json` and a worker brief asks for a review.

**What you do.** Name the model once. See [Configuration](configuration.md#crewslots).

**What the package decides.** Where each launch goes. Any launch, review or not, goes to the slot when Jev's slot probability is at least .6 and neither the `expert` nor the `risky` rule matched first. Otherwise the launch gets `expert`, `deep` (risky) or a tier from the mode's cut points; see [the rules](domain-model.md#workerdecision).

The reviewer slot is not the CLI review. The CLI review (`jev_review`, which runs Codex or OpenCode) is off by default and runs only when you ask. Turn it on with `/jev cli-review on` ([usage guide](usage-guide.md#reviews)).

## Which rule wins

Three kinds of list follow. In a "first match wins" list, the first rule that applies decides. In an "applied in order" list, every step runs in turn. Some rules are a single line.

**Mode** for a session ([usage guide](usage-guide.md#modes)), first match wins:

1. Directory mode, from `<cwd>/.pi/jev-mode.json`
2. Global mode, from `state.json`
3. The default, `standard`

**CLI review on or off** ([configuration](configuration.md#review)), first match wins: `state.json` `cliReviewEnabled`, then `config.json` `review.enabled`, then off.

**Worker launch** ([rules](domain-model.md#workerdecision))

Guards first. They leave a launch alone, or partly alone:

- `resume`, or a fork with `untouched`: the launch is not changed.
- Agent `locked`: if the model is locked, only thinking is written; if both are locked, the launch is untouched.

Target, first match wins:

1. `expert`
2. `risky`
3. Slot probability ≥ .6
4. Cut points

Then availability: an unusable tier moves down, never to `expert`; an unusable slot moves to `balanced`, then `fast`.

Effort, applied in order:

1. Jev's choice
2. At least `high` on risk
3. Cap `xhigh`
4. Cap `medium` on `fast`
5. Clamp to the model

After a fallback move, effort is `xhigh` on every tier, without the `fast` cap.

To override: lock the model or thinking in the agent file.

**Main prompt** ([rules](domain-model.md#maindecision))

Guards first:

- A manual level change during an outstanding request discards that result.
- `holdProviders` keep the newest level until a compaction or a provider or model switch, without asking Jev.
- A current `max` is left alone.

Then, applied in order:

1. Jev's choice
2. At least `high` on risk
3. Start capped at `xhigh`
4. Clamp to the model

To override: change the level yourself, run `/jev effort off`, or edit `effort.holdProviders` in `config.json`.

**Config value** ([files](configuration.md#files)), first match wins:

1. `tuning.json`
2. `state.json`
3. `config.json`
4. The default

To override: edit `config.json` (your value replaces a tuned one), run `/jev tune undo` or `/jev tune reset` to drop a tuned value, or `/jev tune off` to stop automatic changes.
