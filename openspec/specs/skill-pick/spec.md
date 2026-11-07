# skill-pick Specification

## Purpose
Pi-free rules for picking at most one skill per main prompt: the text Jev reads for each skill, catalog batches, the `which` and gate questions, how their answers become a pick, the text attached for a picked skill, and the check that avoids sending the same body twice.

## Requirements

### Requirement: Skill criterion
For each catalog entry the package SHALL build the option text as `<description> — <body excerpt>`: the trimmed description, and the trimmed body (frontmatter already removed) cut to 300 code points. A part empty after trimming is absent. With one part present, the criterion MUST be that part alone; with none, `A skill named <name>.`.

#### Scenario: Description and body
- **WHEN** an entry has description `Debug failures` and a body of 400 code points
- **THEN** its criterion is `Debug failures — ` followed by the body's first 300 code points

#### Scenario: Body only
- **WHEN** an entry has no description and a non-empty body
- **THEN** its criterion is the body excerpt alone, with no separator

#### Scenario: Description only
- **WHEN** an entry has a description and an empty body
- **THEN** its criterion is the description alone, with no separator

#### Scenario: Neither
- **WHEN** an entry named `notes` has no description and no body
- **THEN** its criterion is `A skill named notes.`

#### Scenario: Whitespace-only description
- **WHEN** an entry has description `   ` and a non-empty body
- **THEN** its criterion is the body excerpt alone

#### Scenario: Surrogate pairs are not split
- **WHEN** the body's 300th code point is an emoji outside the Basic Multilingual Plane
- **THEN** the excerpt ends with the whole emoji and no lone surrogate

### Requirement: Catalog batches
The package SHALL split the catalog into as few batches as hold at most 254 skills each, of near-equal size, in catalog order: with `n` skills, `ceil(n / 254)` batches of `ceil(n / count)` skills, the last batch holding the rest. An empty catalog MUST give no batch. When two entries share a name, only the first MUST be kept, and an entry named `(none)` MUST be left out, so options stay unique.

#### Scenario: Small catalog
- **WHEN** the catalog has 78 skills
- **THEN** there is one batch of 78 skills in catalog order

#### Scenario: Exactly 254
- **WHEN** the catalog has 254 skills
- **THEN** there is one batch

#### Scenario: Just over the limit
- **WHEN** the catalog has 255 skills
- **THEN** there are two batches, of 128 and 127 skills, in catalog order

#### Scenario: Near-equal split
- **WHEN** the catalog has 302 skills
- **THEN** there are two batches of 151 skills each

#### Scenario: Three batches
- **WHEN** the catalog has 509 skills
- **THEN** there are three batches, of 170, 170 and 169 skills

#### Scenario: Empty catalog
- **WHEN** the catalog has no skill
- **THEN** there is no batch

#### Scenario: Skill named none
- **WHEN** an entry is named `(none)`
- **THEN** it is in no batch

#### Scenario: Repeated name
- **WHEN** two entries are named `review`
- **THEN** only the first `review` entry is in a batch

### Requirement: Skill questions
When skill questions are asked, the first batch's request SHALL carry, after the existing main questions, a `which` choice and the three gates `gate::acts_on_user_system`, `gate::would_follow_documented_procedure` and `gate::prose_suffices`; each later batch's request MUST carry only its own `which`. When skill questions are not asked, the main questions MUST be unchanged. Which requests carry skill questions is decided in `wg-09-skill-host`.

#### Scenario: First batch with effort
- **WHEN** main questions are built with effort asked and a first batch of three skills
- **THEN** the question keys are, in order, `effort`, `risky`, `corrects`, `which`, `gate::acts_on_user_system`, `gate::would_follow_documented_procedure`, `gate::prose_suffices`

#### Scenario: First batch without effort
- **WHEN** main questions are built with effort not asked and a first batch of skills
- **THEN** the question keys are, in order, `corrects`, `which`, `gate::acts_on_user_system`, `gate::would_follow_documented_procedure`, `gate::prose_suffices`

#### Scenario: Later batch
- **WHEN** the questions for a second batch are built
- **THEN** they have exactly the key `which`

#### Scenario: Skills not asked
- **WHEN** main questions are built without skills
- **THEN** the result equals the main questions built before this change, for both values of effort asked

### Requirement: Which options and wording
Every `which` SHALL list its batch's skills in catalog order, keyed by name with the skill criterion as value, then `(none)`. The accepted options MUST be exactly those asked. The `which` instruction, the `(none)` criterion and each gate's question text (without the note on inversion) MUST be the text in `docs/jev-questions.md`, verbatim.

#### Scenario: Which option order
- **WHEN** the batch is `debug`, `plan`, `review`
- **THEN** `which.criteria` has exactly the keys `debug`, `plan`, `review`, `(none)` in that order, and the accepted options are the same list

#### Scenario: Wording matches the docs
- **WHEN** the skill questions are built
- **THEN** the `which` instruction, the `(none)` criterion and each gate instruction appear verbatim in `docs/jev-questions.md`

### Requirement: Batch leader
For each batch the package SHALL take as leader the option with the highest probability in that batch's `which` answer, `(none)` included; on equal probabilities the option listed earlier wins. A batch led by `(none)` MUST be ignored: it offers no skill, even when a skill is second. Across batches, the best leader MUST be the offered leader with the highest probability; on equal probabilities the earlier batch wins. `confidence` and the reported `choice` MUST NOT be used.

#### Scenario: Leader is a skill
- **WHEN** a batch answers `debug` .6, `plan` .3, `(none)` .1
- **THEN** its leader is `debug` at .6

#### Scenario: Leader is none
- **WHEN** a batch answers `debug` .3, `(none)` .7
- **THEN** the batch offers no skill

#### Scenario: Tie within a batch
- **WHEN** `plan` and `debug` both have .4, and `debug` is listed first
- **THEN** the leader is `debug`

#### Scenario: Best across batches
- **WHEN** batch 1's leader is `plan` at .55 and batch 2's leader is `deploy` at .7
- **THEN** the best leader is `deploy` at .7

#### Scenario: Choice field ignored
- **WHEN** a batch reports `choice` `plan` but `debug` has the highest probability
- **THEN** the leader is `debug`

### Requirement: Gate mean
The gate mean SHALL be the mean of the gate answers read from the first batch, with `gate::prose_suffices` counted as `1 - p`. Gates that were not read MUST be left out of the mean. When no gate was read, the gate mean MUST be absent.

#### Scenario: All gates
- **WHEN** the gates read `acts_on_user_system` .8, `would_follow_documented_procedure` .9, `prose_suffices` .1
- **THEN** the gate mean is .866… (the mean of .8, .9 and .9)

#### Scenario: One gate missing
- **WHEN** only `acts_on_user_system` .6 and `prose_suffices` .2 were read
- **THEN** the gate mean is .7

#### Scenario: No gate
- **WHEN** no gate answer was read
- **THEN** the gate mean is absent

### Requirement: Pick rule
The package SHALL pick the best leader when its probability is at least .5, or when its probability is at least .3 and the gate mean is present and at least .3; otherwise no skill MUST be picked. When any batch has no readable `which` answer, including a failed Jev request for that batch, no skill MUST be picked. The result MUST carry the picked name or none, and the best leader's probability when a leader was offered, and the gate mean when present; a failed batch MUST give neither.

#### Scenario: Sure pick
- **WHEN** the best leader is `debug` at .5 and the gate mean is .1
- **THEN** `debug` is picked

#### Scenario: Gate supports a weaker pick
- **WHEN** the best leader is `debug` at .3 and the gate mean is .3
- **THEN** `debug` is picked

#### Scenario: Gate too low
- **WHEN** the best leader is `debug` at .45 and the gate mean is .29
- **THEN** no skill is picked, and the result carries .45 and .29

#### Scenario: Probability too low
- **WHEN** the best leader is `debug` at .29 and the gate mean is .9
- **THEN** no skill is picked

#### Scenario: No gate and a weaker pick
- **WHEN** the best leader is `debug` at .4 and the gate mean is absent
- **THEN** no skill is picked

#### Scenario: Every batch led by none
- **WHEN** every batch is led by `(none)`
- **THEN** no skill is picked and the result carries no probability

#### Scenario: No batch
- **WHEN** the catalog was empty, so there is no batch
- **THEN** no skill is picked and the result carries no probability and no gate mean

#### Scenario: Jev failure on a later batch
- **WHEN** batch 1 answers `debug` at .9 and the request for batch 2 failed
- **THEN** no skill is picked, and the result carries no probability and no gate mean

#### Scenario: Unreadable which
- **WHEN** the only batch's `which` answer is unanswered (missing, wrong options or out-of-range probabilities)
- **THEN** no skill is picked

### Requirement: Delivery text
The package SHALL build the text for a picked skill in one of three forms, as written in `docs/jev-questions.md`: `content` (name, file path, base directory, whole body), `suggest` (name, file path, base directory, no body) and `reference` (named as already loaded, no path, no body). Every form MUST be wrapped in a `<skill_relevance>` element whose first line names the skill and says to ignore it when it does not fit. Values MUST be inserted verbatim.

#### Scenario: Content form
- **WHEN** the `content` text is built for `debug` at `/s/debug/SKILL.md`, base `/s/debug`, body `Step one.`
- **THEN** it equals the docs' `content` template with those values, and contains `Step one.` once

#### Scenario: Suggest form
- **WHEN** the `suggest` text is built for the same skill
- **THEN** it equals the docs' `suggest` template with those values and does not contain the body

#### Scenario: Reference form
- **WHEN** the `reference` text is built for `debug`
- **THEN** it equals the docs' `reference` template and contains no path and no body

#### Scenario: Special characters in a path
- **WHEN** the file path contains `$&` and `$1`
- **THEN** the text contains them unchanged

### Requirement: Duplicate check
Given the picked skill's name and body fingerprint, `skills.inject` and the caller's list of skill bodies in context since the latest compaction, the package SHALL choose `reference` when the list holds the same name with the same fingerprint, and otherwise the configured form, `content` or `suggest`. The check MUST look nothing else up and MUST compare fingerprints as opaque strings.

#### Scenario: First pick on the branch
- **WHEN** `debug` is picked with `inject` `content` and the list is empty
- **THEN** the form is `content`

#### Scenario: Same body already in context
- **WHEN** `debug` is picked and the list holds `debug` with the same fingerprint
- **THEN** the form is `reference`

#### Scenario: Skill edited since
- **WHEN** `debug` is picked and the list holds `debug` with a different fingerprint
- **THEN** the form is the configured form

#### Scenario: Suggest configured
- **WHEN** `debug` is picked with `inject` `suggest` and the list is empty
- **THEN** the form is `suggest`

#### Scenario: Another skill in context
- **WHEN** `debug` is picked and the list holds only `plan`
- **THEN** the form is the configured form

### Requirement: Pure and Pi-free
The skill criterion, batching, pick rule, delivery text and duplicate check SHALL live in `src/policy/` with no Pi import and no I/O, and the skill questions in `src/jev/` with no Pi import. Lint MUST enforce both.

#### Scenario: Lint boundaries
- **WHEN** lint runs on the change
- **THEN** it passes, and `src/policy/skill.ts` imports only from `src/policy/` and `src/shared/`
