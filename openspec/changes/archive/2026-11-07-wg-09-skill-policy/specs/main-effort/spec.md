## MODIFIED Requirements

### Requirement: Question wire format
Each question SHALL use the TypeSafe wire format: a choice carries `type` `choice`, `instructions` and `criteria` mapping each option to its description; a noul carries `type` `noul`, `instructions` and `criteria` with `true` and `false`. The three skill gates `gate::acts_on_user_system`, `gate::would_follow_documented_procedure` and `gate::prose_suffices` are the only exception: each MUST carry exactly `type` `noul` and `instructions`, with no `criteria`.

#### Scenario: Choice shape
- **WHEN** the `effort` question is built
- **THEN** it has exactly the keys `type`, `instructions` and `criteria`, and each `criteria` value is the level's criterion text

#### Scenario: Noul shape
- **WHEN** the `risky` question is built
- **THEN** its `criteria` has exactly the keys `true` and `false`

#### Scenario: Skill gate shape
- **WHEN** the skill gates are built
- **THEN** each has exactly the keys `type` and `instructions`, and `type` is `noul`
