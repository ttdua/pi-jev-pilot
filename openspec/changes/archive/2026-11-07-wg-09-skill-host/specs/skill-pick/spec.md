## MODIFIED Requirements

### Requirement: Skill questions
When skill questions are asked, the first batch's request SHALL carry, after the existing main questions, a `which` choice and the three gates `gate::acts_on_user_system`, `gate::would_follow_documented_procedure` and `gate::prose_suffices`; each later batch's request MUST carry only its own `which`. When skill questions are not asked, the main questions MUST be unchanged. Which requests carry skill questions is defined by the `skill-delivery` capability.

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
