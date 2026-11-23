## ADDED Requirements

### Requirement: Tuned turn floors
The result SHALL carry `turnFloors` with `medium`, `long` and `very_long`. Each band's value SHALL be its tuned value when the tuning layer holds one whose `value` and `base` are integers in the band's range and whose `base` equals the band's built-in floor (40, 100, 200), and otherwise the built-in floor. When the resolved floors are not strictly ordered `medium < long < very_long`, every tuned floor MUST be ignored and the built-in floors used.

#### Scenario: Built-in floors
- **WHEN** there is no tuning layer
- **THEN** the result's `turnFloors` is `medium` 40, `long` 100, `very_long` 200

#### Scenario: Tuned floor applies
- **WHEN** the tuning layer sets the `long` floor to value 80 with base 100
- **THEN** the result's `turnFloors.long` is 80

#### Scenario: Base differs from the built-in floor
- **WHEN** the tuning layer sets the `long` floor to value 80 with base 90
- **THEN** the result's `turnFloors.long` is 100

#### Scenario: Out of range ignored
- **WHEN** the tuning layer sets the `medium` floor to value 100 with base 40
- **THEN** the result's `turnFloors.medium` is 40

#### Scenario: Order broken
- **WHEN** the tuning layer sets the `medium` floor to value 80 with base 40 and the `long` floor to value 60 with base 100
- **THEN** the result's `turnFloors` is `medium` 40, `long` 100, `very_long` 200

## MODIFIED Requirements

### Requirement: Tuning is limited to tunable values
The tuning layer SHALL accept only `timeoutMs` and the band floors. `timeoutMs` is a `value` and the `base` it was tuned from, each an integer from 300 to 5000. The tuned value MUST apply only when `base` equals the untuned value (the config's `classifier.timeoutMs`, or the default). Otherwise the untuned value applies. Band floors follow Tuned turn floors. Any other value in the tuning layer MUST be ignored by the resolver.

#### Scenario: Non-integer tuning ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `1800.5` with base `1500`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default

#### Scenario: Out-of-range tuning ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `9000` with base `1500`
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default

#### Scenario: Config edited after tuning
- **WHEN** the config sets `classifier.timeoutMs` to `2000` and the tuning layer sets `timeoutMs` to value `1700` with base `1500`
- **THEN** the result's `classifier.timeoutMs` is `2000`

#### Scenario: Tuned from the default
- **WHEN** the config does not set `classifier.timeoutMs` and the tuning layer sets `timeoutMs` to value `1700` with base `1500`
- **THEN** the result's `classifier.timeoutMs` is `1700`

#### Scenario: Invalid base ignored
- **WHEN** the config does not set `classifier.timeoutMs` and the tuning layer sets `timeoutMs` to value `1700` with base `1500.5`
- **THEN** the result's `classifier.timeoutMs` is `1500`

#### Scenario: Missing base ignored
- **WHEN** the tuning layer sets `timeoutMs` to value `1700` with no base
- **THEN** the result's `classifier.timeoutMs` comes from the config or the default
