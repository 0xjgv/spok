# explore-mode Specification

## Purpose
TBD - created by archiving change bring-previous-explore-skill. Update Purpose after archive.
## Requirements
### Requirement: Explore workflow skill is installed
Spok SHALL include `spok-explore` in the user-facing workflow skills installed or refreshed for every selected tool that supports skills.

#### Scenario: Init installs explore skill
- **WHEN** `spok init` configures a supported tool
- **THEN** the tool's skills directory contains `spok-explore/SKILL.md` alongside `spok-propose/SKILL.md`, `spok-apply/SKILL.md`, and `spok-archive/SKILL.md`

#### Scenario: Update refreshes explore skill
- **WHEN** `spok update --force` refreshes an already configured supported tool
- **THEN** the tool's skills directory contains a regenerated `spok-explore/SKILL.md`

### Requirement: Explore mode stays non-implementing
The `spok-explore` skill SHALL define a thinking-only mode that can read files, search the codebase, inspect Spok artifacts, ask clarifying questions, compare options, and summarize findings, but MUST NOT write implementation code or make source changes.

#### Scenario: Skill content forbids implementation
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it tells the agent that explore mode is for thinking, not implementing
- **AND** it tells the agent not to write code or implement features while in explore mode

#### Scenario: Skill content allows investigation
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it allows codebase reading, searching, and investigation as part of exploration

### Requirement: Explore mode is Spok-aware
The `spok-explore` skill SHALL tell the agent to ground exploration in current Spok context when useful, including active changes and their existing artifacts.

#### Scenario: Skill checks active Spok context
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it instructs the agent to check current Spok state with `spok list --json`

#### Scenario: Skill reads mentioned change artifacts
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it instructs the agent to use `spok status --change "<name>" --json` for a relevant change and read existing artifact paths from that status output

### Requirement: Explore mode captures decisions only by user consent
The `spok-explore` skill SHALL allow the agent to offer artifact updates when decisions crystallize, but MUST tell the agent not to auto-capture those decisions without user consent.

#### Scenario: Skill offers artifact capture
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it explains where requirements, design decisions, scope changes, and new work can be captured

#### Scenario: Skill forbids automatic capture
- **WHEN** the generated `spok-explore/SKILL.md` is read
- **THEN** it tells the agent to offer capture and let the user decide

### Requirement: Explore is not treated as retired
Spok SHALL treat `spok-explore` as a current user-facing skill during init and update cleanup.

#### Scenario: Legacy cleanup preserves current explore skill
- **WHEN** legacy cleanup scans a supported tool's skills directory
- **THEN** `spok-explore` is not reported as a retired skill directory

### Requirement: Documentation lists explore
User-facing documentation SHALL list `spok-explore` as the pre-proposal exploration skill and SHALL describe it as a thinking-only mode.

#### Scenario: Command docs include explore
- **WHEN** the command reference is read
- **THEN** it lists `/spok-explore` with the other user-facing Spok workflow invocations

#### Scenario: Migration docs map old explore to current explore
- **WHEN** the migration guide is read
- **THEN** it maps the prior `/opsx:explore` workflow to `/spok-explore`

