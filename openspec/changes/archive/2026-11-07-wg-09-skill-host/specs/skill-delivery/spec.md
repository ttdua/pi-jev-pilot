## ADDED Requirements

### Requirement: Skill catalog
The package SHALL build the catalog from `pi.getCommands()` entries with `source` `skill`, in Pi's order: name without the `skill:` prefix, file `sourceInfo.path`, base directory the file's directory (as Pi's own block uses, not `sourceInfo.baseDir`), body as Pi builds it for `/skill:name` (frontmatter removed, trimmed), and the command's description. It MUST be read only when the other `main-effort` eligibility conditions hold, `skills` is on, and the prompt has no explicit skill.

#### Scenario: Skills listed by Pi
- **WHEN** Pi lists skills `debug` and `plan`, both readable
- **THEN** the catalog is `debug`, `plan`, in that order, each with its file path, the file's directory, trimmed body without frontmatter, and description

#### Scenario: Package base directory
- **WHEN** Pi reports `sourceInfo.baseDir` as the agent or package root for `debug` at `/a/skills/debug/SKILL.md`
- **THEN** `debug`'s base directory is `/a/skills/debug`

#### Scenario: Skills off
- **WHEN** the `skills` feature is off
- **THEN** no skill file is read

#### Scenario: Ineligible prompt
- **WHEN** the key variable is unset, or the session is a child, and a prompt is submitted
- **THEN** no skill file is read

### Requirement: Catalog exclusions
A skill MUST be left out of the catalog when its file cannot be read or parsed, when its frontmatter sets `disable-model-invocation: true`, or when its name does not match `^[a-z0-9][a-z0-9-]{0,63}$`. A failure on one entry MUST NOT drop any other.

#### Scenario: Model invocation disabled
- **WHEN** `deploy`'s frontmatter sets `disable-model-invocation: true`
- **THEN** `deploy` is not in the catalog

#### Scenario: Unreadable file
- **WHEN** `plan`'s file was deleted after Pi loaded it
- **THEN** `plan` is not in the catalog and `debug` still is

#### Scenario: Name the ledger cannot record
- **WHEN** Pi lists a skill named `My_Skill`
- **THEN** it is not in the catalog

#### Scenario: Other commands
- **WHEN** Pi lists an extension command `jev` and a prompt template `fix`
- **THEN** neither is in the catalog

### Requirement: When skill questions are asked
Skills SHALL apply to an eligible main prompt when the `skills` feature is on, the prompt has no explicit skill, and the catalog is not empty. When skills apply, the main request MUST carry the first batch's skill questions as `skill-pick` defines, and each later batch MUST be sent as its own request at the same time, with the same state, timeout and cancellation. When skills do not apply, no skill question MUST be sent and no skill message MUST be attached.

#### Scenario: One batch
- **WHEN** skills apply with a catalog of 3 skills
- **THEN** exactly one Jev request is sent, and it carries `which` and the three gates

#### Scenario: Two batches
- **WHEN** skills apply with a catalog of 300 skills
- **THEN** two Jev requests are sent before the first provider request: the main request with the first 150 skills, and one with only `which` over the other 150

#### Scenario: Empty catalog
- **WHEN** the `skills` feature is on and no skill is listed
- **THEN** no skill question is sent

### Requirement: Explicit skill skips the skill questions
A prompt SHALL count as having an explicit skill when it starts with the block Pi builds for `/skill:name`: `<skill name="<name>" location="<path>">`, a line break, then `References are relative to `. Such a prompt MUST NOT carry skill questions, and the package MUST attach no skill message for it. Its other main questions MUST be unchanged.

#### Scenario: Operator loads a skill
- **WHEN** the operator submits `/skill:debug fix the test` with `effort` and `skills` on
- **THEN** one Jev request is sent with the effort questions and `corrects`, and no `which` or gate

#### Scenario: Skill block later in the prompt
- **WHEN** the prompt is pasted text that contains `<skill name="debug"` after other text
- **THEN** the prompt has no explicit skill

#### Scenario: Unexpanded skill command
- **WHEN** the prompt starts with `/skill:unknown` and Pi left it unexpanded
- **THEN** the prompt has no explicit skill, and skill questions are asked when skills apply

### Requirement: Skill message
When a skill is picked, the package SHALL return from `before_agent_start` one message with `customType` `jev-skill`, `display` `false`, `content` the `skill-pick` delivery text in the chosen form, and `details` holding `name`, `fingerprint` (hex SHA-256 of the body) and `form`. With no pick, no skill message MUST be returned. No effort outcome MUST stop the message, and a skill MUST NOT change the status line.

#### Scenario: Content form
- **WHEN** `debug` is picked with `skills.inject` `content` and is not in context
- **THEN** the first provider request contains `debug`'s body once, inside `<skill_relevance>`, and the operator sees no new message in the transcript

#### Scenario: Suggest form
- **WHEN** `debug` is picked with `skills.inject` `suggest`
- **THEN** the first provider request contains `debug`'s file path and not its body

#### Scenario: None leads
- **WHEN** Jev's `which` is led by `(none)`
- **THEN** no skill message is attached, and the first provider request has no `<skill_relevance>` text

#### Scenario: Gate too low
- **WHEN** the leader is `debug` at .4 and the gate mean is .2
- **THEN** no skill message is attached

#### Scenario: Level changed during the wait
- **WHEN** `debug` is picked and the operator changed the thinking level while Jev answered
- **THEN** the effort result is discarded and the skill message is still attached

#### Scenario: Held prompt with a pick
- **WHEN** the prompt is held and `debug` is picked
- **THEN** the skill message is attached, the level is unchanged, and the `main` line has `held` true, `effective` and `skill` `debug`

#### Scenario: Max kept with a pick
- **WHEN** the session level is `max` and `debug` is picked
- **THEN** the level stays `max` and the skill message is attached

#### Scenario: Effort unanswered with a pick
- **WHEN** `effort` comes back with an unknown choice and `debug` is picked
- **THEN** the level is unchanged and the skill message is attached

#### Scenario: Skills only
- **WHEN** `effort` is off, skills apply and `debug` is picked
- **THEN** the skill message is attached, the status line is unchanged, and the `jev-turn` entry data is exactly `{ turnId }`

#### Scenario: Esc after the pick
- **WHEN** `debug` is picked and the operator aborts before any provider request
- **THEN** no provider request is made and no ledger line is written

### Requirement: No duplicate body in context
The package SHALL choose the form with `skill-pick`'s duplicate check, given the skills loaded in the context Pi sends to the model now (`sessionManager.buildSessionProjection()`, after compaction and context edits). Entries a compaction dropped, or a context edit removed or rewrote, MUST NOT count; entries a compaction kept MUST count. A `jev-skill` message counts only in the `content` form, with its `details.name` and `details.fingerprint`; `suggest` and `reference` messages MUST NOT count.

#### Scenario: Kept across a compaction
- **WHEN** `debug` was delivered in a message that the compaction kept, and `debug` is picked again
- **THEN** the `reference` form is attached

#### Scenario: Picked twice on one branch
- **WHEN** `debug` is picked on three prompts in a row with `inject` `content`
- **THEN** the session holds exactly one `jev-skill` message in the `content` form, every provider request from the first turn on contains `debug`'s body exactly once, and the second and third prompts attach the `reference` form

#### Scenario: Removed by a context edit
- **WHEN** `debug` was delivered and a context edit then removed or rewrote that message, and `debug` is picked again
- **THEN** the `content` form is attached

#### Scenario: Skill edited since
- **WHEN** `debug` was delivered, its file was then edited, and it is picked again
- **THEN** the `content` form with the new body is attached

#### Scenario: After a compaction
- **WHEN** `debug` was delivered, a compaction dropped that message, and `debug` is picked again
- **THEN** the `content` form is attached

#### Scenario: Other branch
- **WHEN** `debug` was delivered on one branch and the operator moved with `/tree` to a point before it
- **THEN** a pick of `debug` attaches the `content` form

#### Scenario: Suggested before
- **WHEN** `debug` was attached in the `suggest` form and is picked again with `inject` `content`
- **THEN** the `content` form is attached

### Requirement: Explicit skill counts as loaded
A user message in context whose first text part starts with Pi's `/skill:name` block for a catalog skill SHALL count as that skill loaded. It MUST carry the current fingerprint only when that text starts with the whole block built from the current body; otherwise it MUST match no fingerprint.

#### Scenario: Loaded by the operator
- **WHEN** the operator ran `/skill:debug` on an earlier prompt and `debug` is picked now
- **THEN** the `reference` form is attached

#### Scenario: Loaded before an edit
- **WHEN** the operator ran `/skill:debug`, the file was then edited, and `debug` is picked
- **THEN** the `content` form with the new body is attached

### Requirement: Jev failure attaches no skill
When the main request is a miss (`timeout`, `error` or `schema`) or is cancelled, no skill message SHALL be attached. When the main request answered but any later batch was a miss, was cancelled, or left `which` unreadable, no skill message MUST be attached and effort MUST still apply. A failed skill path MUST NOT add a provider request, delay the turn beyond the configured timeout, or show an error; it is recorded only by the absence of `skill`, `skillP` and `gate`.

#### Scenario: Jev down
- **WHEN** the Jev fixture answers HTTP 500 with `skills` on and a catalog
- **THEN** no skill message is attached and the provider requests equal those of a run without the package

#### Scenario: Later batch fails
- **WHEN** the catalog has 300 skills, the main request answers `effort` `high` and `which` `debug` at .9, and the second batch's request fails
- **THEN** the level is set to `high`, no skill message is attached, and the `main` line has no `skill`, `skillP` or `gate`

#### Scenario: Unreadable which
- **WHEN** the main request answers `effort` but `which` names an option that was not asked
- **THEN** effort applies and no skill message is attached

### Requirement: Host wiring only
Catalog reading, explicit-skill detection, the loaded-in-context scan and fingerprints SHALL live in `src/host/`. Picking, the delivery text and the duplicate decision MUST come from `src/policy/skill.ts` unchanged, and the questions from `src/jev/questions.ts`. Only Pi's public API MUST be used.

#### Scenario: Lint boundaries
- **WHEN** lint runs on the change
- **THEN** it passes, and no file outside `src/host/` and `src/extension.ts` imports `@earendil-works/pi-coding-agent`
