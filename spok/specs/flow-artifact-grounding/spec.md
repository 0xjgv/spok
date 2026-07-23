# flow-artifact-grounding Specification

## Purpose

Workflow artifacts must ground their claims about the repository in evidence. A guess about the repository's own tooling entering at the earliest artifact propagates downstream unchallenged, and a verification claim attributed to no command defeats the redundancy that would otherwise catch it. These requirements pin the rules that close those gaps: a mandatory tooling research question, manifest-sourced plan commands, execution-attributed verification reports, rule-not-snapshot commit constraints, concurrency-safe staging, and a project context that carries conventions rather than perishable facts.

## Requirements

### Requirement: Research questions must ground repository tooling in the manifest

The `spok-create-research-questions` skill SHALL require every run to include one question asking for this repository's actual lint, typecheck, test, and format commands, sourced from `package.json`, `Makefile`, or the equivalent manifest, and MUST forbid inferring those commands from a toolchain name. The mandatory question SHALL count toward the existing question cap.

#### Scenario: Skill content declares the question mandatory

- **WHEN** the generated `spok-create-research-questions/SKILL.md` is read
- **THEN** it instructs the agent that every run must include a question about the repository's lint, typecheck, test, and format commands

#### Scenario: Skill content names the evidence source

- **WHEN** the generated `spok-create-research-questions/SKILL.md` is read
- **THEN** it instructs the agent to source those commands from `package.json`, `Makefile`, or the equivalent manifest
- **AND** it tells the agent not to infer them from a toolchain name

#### Scenario: Mandatory question counts toward the cap

- **WHEN** the generated `spok-create-research-questions/SKILL.md` is read
- **THEN** it states that the mandatory question counts toward the maximum number of questions

### Requirement: Plans must source verification commands from evidence

The `spok-create-plan` skill SHALL require every automated-verification command in the plan to come from the repository's manifest or from `research.md`, MUST forbid naming a command derived from a toolchain guess, and SHALL require the plan to state plainly when research did not establish the commands rather than hedging.

#### Scenario: Skill content requires an evidence source for commands

- **WHEN** the generated `spok-create-plan/SKILL.md` is read
- **THEN** it instructs the agent that automated-verification commands must come from the repository's manifest or from `research.md`
- **AND** it tells the agent never to name a command from a toolchain guess

#### Scenario: Skill content forbids hedging over unknown commands

- **WHEN** the generated `spok-create-plan/SKILL.md` is read
- **THEN** it instructs the agent to say that research did not establish the commands, rather than hedging with a conditional such as "if configured"

### Requirement: Implementation reports must be attributable to executed commands

The `spok-implement-plan` skill SHALL require the agent to report only checks it actually executed, to name the exact command and its real output, and — when the plan names a command that does not exist in this repository — to say so rather than substituting a different command silently or reporting the named command as passing.

#### Scenario: Skill content limits reporting to executed checks

- **WHEN** the generated `spok-implement-plan/SKILL.md` is read
- **THEN** it instructs the agent to report only checks that were actually executed
- **AND** it instructs the agent to name the exact command run and its real output

#### Scenario: Skill content handles a command the repository lacks

- **WHEN** the generated `spok-implement-plan/SKILL.md` is read
- **THEN** it instructs the agent to report that a plan-named command does not exist in this repository
- **AND** it forbids substituting another command silently or reporting the missing command as passing

### Requirement: Recorded step summaries must not relay unattributed verification claims

The `spok-flow` skill SHALL forbid relaying into `spok flow complete --summary` any verification claim that cannot be attributed to a command that ran during the step.

#### Scenario: Skill content forbids unattributed claims in summaries

- **WHEN** the generated `spok-flow/SKILL.md` is read
- **THEN** it instructs the agent not to relay a verification claim that cannot be attributed to a command that ran

### Requirement: The ticket template states a commit constraint without a status snapshot

The `apply` workflow skill template SHALL include a `## Commit Constraint` section in the staged `ticket.md` markdown that states the staging rule and forbids embedding a `git status` snapshot, and MUST NOT embed a status snapshot itself.

#### Scenario: Generated apply skill carries the commit-constraint rule

- **WHEN** the generated `spok-apply/SKILL.md` is read
- **THEN** the ticket markdown block contains a `## Commit Constraint` section
- **AND** it tells the agent to stage only the paths this chunk touches
- **AND** it tells the agent never to embed a `git status` snapshot because it goes stale and the commit step reads live status

#### Scenario: Generated apply skill embeds no status snapshot

- **WHEN** the generated `spok-apply/SKILL.md` is read
- **THEN** the ticket template contains no captured `git status` output

### Requirement: Commit staging is concurrency-safe and gitignore-aware

The `spok-ci-commit` skill SHALL forbid staging any path the agent did not modify, on the grounds that other agents may be working in the repository concurrently, and SHALL require checking whether a path is gitignored before listing it as an expected file to commit.

#### Scenario: Skill content forbids staging unmodified paths

- **WHEN** the generated `spok-ci-commit/SKILL.md` is read
- **THEN** it instructs the agent never to stage a path it did not modify
- **AND** it explains that other agents may be working in the repository concurrently

#### Scenario: Skill content requires a gitignore check

- **WHEN** the generated `spok-ci-commit/SKILL.md` is read
- **THEN** it instructs the agent never to treat a gitignored path as committable
- **AND** it instructs the agent to check before listing expected files

### Requirement: Project context carries stable conventions only

Spok's own project configuration SHALL populate `context` with stable conventions — the stack, commit-message style, the rule that verification commands are read from `package.json` scripts, and which paths are gitignored vendor targets — and MUST NOT record point-in-time dependency versions or tooling facts.

#### Scenario: Config context states the verification-command convention

- **WHEN** `spok/config.yaml` is read
- **THEN** its `context` value instructs that verification commands are read from `package.json` scripts rather than assumed

#### Scenario: Config context names the gitignored vendor targets

- **WHEN** `spok/config.yaml` is read
- **THEN** its `context` value states that `.claude/` and `.agents/` are gitignored vendor targets

#### Scenario: Config context carries no point-in-time facts

- **WHEN** `spok/config.yaml` is read
- **THEN** its `context` value contains no dependency version numbers
