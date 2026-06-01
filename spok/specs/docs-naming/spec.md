### Requirement: Product name in user-facing docs

User-facing documentation SHALL refer to the product as "Spok" (proper noun) or `spok` (when referring to the CLI binary, package name, or shell invocation).

User-facing documentation MUST NOT contain references to the prior product names "OpenSpec" or "OPSX" except inside contexts that explicitly document the rename.

The following files are treated as historical and are excluded from this rule:
- `CHANGELOG.md`
- `.changeset/*.md`
- `docs/migration-guide.md`

#### Scenario: Spok product name is used in docs

- **WHEN** a contributor adds or edits any file under `docs/` (excluding `docs/migration-guide.md`), or edits `README.md` or `AGENTS.md`
- **THEN** every product reference uses "Spok" or `spok`, and no occurrence of `OpenSpec` (case-insensitive) or `OPSX`/`opsx` (case-insensitive) appears

#### Scenario: Historical files retain legacy names

- **WHEN** `CHANGELOG.md`, any file under `.changeset/`, or `docs/migration-guide.md` is inspected
- **THEN** legacy `OpenSpec`, `OPSX`, and `opsx` references MAY remain (they document the rename)

### Requirement: Slash-command references use the spok-* prefix

User-facing documentation, generated templates, and generated skill bodies SHALL reference Spok slash commands using the `/spok-<verb>` form (e.g. `/spok-propose`, `/spok-apply`, `/spok-archive`).

The legacy `/opsx:<verb>` form MUST NOT appear in user-facing docs, source templates, or generated files, except inside the historical files listed in the previous requirement.

`src/core/legacy-cleanup.ts` MAY reference the literal strings `opsx`, `commands/opsx`, and `opsx-*` because its job is to delete legacy artifacts on upgrade.

#### Scenario: Docs reference current slash commands

- **WHEN** a doc references a Spok command
- **THEN** it uses the `/spok-<verb>` form, never `/opsx:<verb>` or bare `opsx`

#### Scenario: Legacy-cleanup is exempt

- **WHEN** `src/core/legacy-cleanup.ts` (and its tests) names the `opsx` directory or `opsx-*` file pattern
- **THEN** the literal is preserved because it identifies files that must be removed on upgrade
