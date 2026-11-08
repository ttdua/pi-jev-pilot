# Documentation

## By reader

**Using the package**

- [Usage guide](usage-guide.md): install, first run, modes, slots, reviews, troubleshooting
- [Scenarios](scenarios.md): what changes for you, with measured numbers
- [Configuration reference](configuration.md): every setting and file
- [Privacy](privacy.md): what leaves the machine, and what is stored

**Understanding the system**

- [Architecture](architecture.md): modules, boundaries, host seams
- [Domain model](domain-model.md): the concepts, their rules and their relationships
- [Workflows](workflow.md): each runtime flow, step by step
- [Jev contract](jev-contract.md): the requests and how answers become decisions
- [Jev questions](jev-questions.md): the exact wording sent to Jev and added to context
- [Glossary](glossary.md): the vocabulary used everywhere else

**Building it**

- [Roadmap](roadmap.md): work groups, order and acceptance criteria
- [Testing strategy](testing.md): test levels and what each may claim
- [Contributing](../CONTRIBUTING.md): conventions and the definition of done

**Why it is this way**

- [Project brief](project-brief.md): intent, goals, non-goals, scope, approaches considered
- [Decision records](decisions/README.md): one decision per file
- [Evidence](evidence/2026-11-05-replay.md): measurements behind the decisions; [routing by mode, 2026-11-07](evidence/2026-11-07-replay.md); [0.1 release report, 2026-11-08](evidence/2026-11-08-release.md)

## Which document wins

1. Code and tests describe what the system does.
2. Decision records explain why, and are replaced rather than edited.
3. The other documents here are kept up to date with the code. A change that alters behavior updates them in the same commit.
