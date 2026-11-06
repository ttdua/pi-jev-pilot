## ADDED Requirements

### Requirement: Envelope check
Answer reading SHALL return either a `miss` with kind `schema`, or a `read` result holding `answers` (valid answers by key) and `unanswered` (reasons by key). It SHALL report the whole request as the `schema` miss when the body is not a JSON object, or has no `answers` field whose value is an object. Otherwise it MUST read each asked question independently.

#### Scenario: Missing answers
- **WHEN** the body is `{"model": "jev-1.14.0"}`
- **THEN** the result is a `schema` miss

#### Scenario: Answers is not an object
- **WHEN** the body is `{"answers": []}` or `{"answers": null}`, or the body itself is an array
- **THEN** the result is a `schema` miss

### Requirement: Every asked question is accounted for
For a body with an `answers` object, answer reading SHALL place each asked key in exactly one of: valid answers, or unanswered with a reason from `missing`, `type`, `choice`, `probabilities` or `range`. Keys in `answers` that were not asked MUST be ignored.

#### Scenario: Unasked key ignored
- **WHEN** the questions asked are `risky` only, and `answers` contains a valid `risky` and an extra `effort`
- **THEN** the valid answers contain only `risky`, and `effort` appears nowhere in the result

#### Scenario: Asked key absent
- **WHEN** `effort` was asked and `answers` has no `effort` key
- **THEN** `effort` is unanswered with reason `missing`

### Requirement: Choice answers are strict
A choice answer SHALL count only when its `type` is `choice`, its `choice` is one of the question's options, its `probabilities` is an object whose keys are exactly the question's options, and every probability is a finite number from 0 to 1 inclusive. Otherwise that question MUST be unanswered. Checks MUST run in the order type, choice, probabilities, range, and the first failing check names the reason, as the scenarios below show.

#### Scenario: Valid choice
- **WHEN** `effort` with options `low`, `medium`, `high`, `xhigh`, `max` is answered `{"type":"choice","choice":"low","confidence":0.73,"probabilities":{"low":0.78,"medium":0.15,"high":0.06,"xhigh":0.01,"max":0}}`
- **THEN** `effort` is valid with choice `low` and those probabilities

#### Scenario: Unknown choice
- **WHEN** the `effort` answer has choice `extreme`
- **THEN** `effort` is unanswered with reason `choice`

#### Scenario: Missing probability key
- **WHEN** the `effort` answer's `probabilities` lacks `max`
- **THEN** `effort` is unanswered with reason `probabilities`

#### Scenario: Extra probability key
- **WHEN** the `effort` answer's `probabilities` also has `ultra`
- **THEN** `effort` is unanswered with reason `probabilities`

#### Scenario: Probability out of range
- **WHEN** one of the `effort` probabilities is `1.2`, `-0.1`, or the string `"0.5"`
- **THEN** `effort` is unanswered with reason `range`

#### Scenario: Wrong type for a choice question
- **WHEN** `effort` is answered `{"type":"noul","noul":0.4}`, `null`, or the string `"low"`
- **THEN** `effort` is unanswered with reason `type`

#### Scenario: Probabilities not an object
- **WHEN** the `effort` answer's `probabilities` is `null`, an array, or a string
- **THEN** `effort` is unanswered with reason `probabilities`

### Requirement: Noul answers are strict
A noul answer SHALL count only when its `type` is `noul` and its `noul` is a finite number from 0 to 1 inclusive. Otherwise that question MUST be unanswered: reason `type` for a wrong or absent type or a non-object answer, and `range` for a non-number, non-finite or out-of-range value.

#### Scenario: Valid noul at a boundary
- **WHEN** `risky` is answered `{"type":"noul","noul":0}` and `corrects` is answered `{"type":"noul","noul":1}`
- **THEN** both are valid, with values 0 and 1

#### Scenario: Noul out of range
- **WHEN** `risky` is answered `{"type":"noul","noul":1.01}`, `{"type":"noul"}`, or `{"type":"noul","noul":"0.5"}`
- **THEN** `risky` is unanswered with reason `range`

#### Scenario: Wrong type for a noul question
- **WHEN** `risky` is answered `{"type":"choice","choice":"yes","probabilities":{"yes":1}}`
- **THEN** `risky` is unanswered with reason `type`

### Requirement: One bad answer leaves the others
Answer reading SHALL decide each question on its own answer only, so that an invalid answer never removes or alters a valid answer to another question.

#### Scenario: Mixed good and bad
- **WHEN** `effort`, `risky` and `strategy` are asked, `effort` and `risky` are valid, and `strategy` has an unknown choice
- **THEN** `effort` and `risky` are valid with their values, and only `strategy` is unanswered

### Requirement: Confidence is carried, never required
Answer reading SHALL keep a choice answer's `confidence` on the read answer when it is a finite number from 0 to 1, and MUST NOT make a choice answer unanswered because `confidence` is absent or invalid.

#### Scenario: Confidence absent
- **WHEN** a choice answer is otherwise valid and has no `confidence`
- **THEN** it is valid, without a confidence value

#### Scenario: Confidence invalid
- **WHEN** a choice answer is otherwise valid and has `confidence` `7`
- **THEN** it is valid, without a confidence value

### Requirement: Reading is pure
Answer reading SHALL be a function of the question specs and the body only, with no I/O and no imports outside `src/policy/`, and MUST NOT mutate its inputs.

#### Scenario: Same input, same result
- **WHEN** the same specs and body are read twice
- **THEN** both results are deeply equal, and the inputs are unchanged
