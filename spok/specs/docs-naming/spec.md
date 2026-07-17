### Requirement: Product name in user-facing docs

User-facing documentation SHALL refer to the product as "Spok" (proper noun) or `spok` (when referring to the CLI binary, package name, or shell invocation).

User-facing documentation MUST NOT contain references to the prior product name "OpenSpec" except inside contexts that explicitly document the rename.

The following files are treated as historical and are excluded from this rule:
- `CHANGELOG.md`
- `.changeset/*.md`
- `docs/migration-guide.md`

#### Scenario: Spok product name is used in docs

- **WHEN** a contributor adds or edits any file under `docs/` (excluding `docs/migration-guide.md`), or edits `README.md` or `AGENTS.md`
- **THEN** every product reference uses "Spok" or `spok`, and no occurrence of `OpenSpec` (case-insensitive) appears

#### Scenario: Historical files retain legacy names

- **WHEN** `CHANGELOG.md`, any file under `.changeset/`, or `docs/migration-guide.md` is inspected
- **THEN** legacy `OpenSpec` references MAY remain because they document the rename

### Requirement: Slash-command references use the spok-* prefix

User-facing documentation, generated templates, and generated skill bodies SHALL reference Spok slash commands using the `/spok-<verb>` form (e.g. `/spok-propose`, `/spok-apply`, `/spok-archive`).

References to the retired action-based slash-command namespace MUST NOT appear in user-facing docs, source templates, generated files, or historical documentation.

#### Scenario: Docs reference current slash commands

- **WHEN** a doc references a Spok command
- **THEN** it uses the `/spok-<verb>` form

#### Scenario: Historical docs avoid the retired namespace

- **WHEN** the changelog, changesets, or migration guide describe earlier workflows
- **THEN** they describe those workflows without reproducing the retired action-based slash-command namespace
