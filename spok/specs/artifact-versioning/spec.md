### Requirement: Canonical frontmatter version

Every Spok-owned artifact that carries YAML frontmatter SHALL declare a `version` field whose value is the canonical string `0.1.0` (no quotes required, but quoting is permitted).

The following files MUST carry frontmatter with `version: 0.1.0`:
- `.claude/skills/spok-*/SKILL.md` (every vendored Spok skill).
- Every Markdown file directly under `docs/`.
- `README.md`, `CHANGELOG.md`.

`AGENTS.md` is **excluded** from this rule. It is kept byte-equal to the gitignored `CLAUDE.md` by the `agents-md-drift` quality gate, and `CLAUDE.md` is not a Spok-owned artifact. Adding frontmatter to `AGENTS.md` alone would break drift; adding it to both would require coordinating with the CLAUDE.md workflow, which is out of scope here. Revisit if the drift gate is removed or CLAUDE.md is brought into scope.

For skill `SKILL.md` files, the version SHALL live at `metadata.version` (matching existing frontmatter shape). For docs and root Markdown files, the version SHALL live at the top level of the frontmatter as `version`.

#### Scenario: Skill frontmatter carries the canonical version

- **WHEN** any `.claude/skills/spok-*/SKILL.md` is parsed
- **THEN** its frontmatter exposes `metadata.version: 0.1.0` (or `"0.1.0"`)

#### Scenario: Doc frontmatter carries the canonical version

- **WHEN** any file matching `docs/*.md`, `README.md`, or `CHANGELOG.md` is parsed
- **THEN** its frontmatter exposes `version: 0.1.0` at the top level

#### Scenario: AGENTS.md is exempt while drift gate enforces parity with CLAUDE.md

- **WHEN** `AGENTS.md` is parsed
- **THEN** no frontmatter `version` field is required, because `agents-md-drift` keeps it byte-equal to the gitignored `CLAUDE.md` which is out of scope

#### Scenario: Missing frontmatter is added

- **WHEN** a file in the in-scope set has no frontmatter block
- **THEN** a new YAML frontmatter block is prepended, containing at least `version: 0.1.0`, before any existing content

### Requirement: Single source of truth for version

The canonical version string `0.1.0` SHALL appear identically across all in-scope files; there MUST NOT be a mix of `"2.0"`, `"1.0"`, `0.3.0`, or other historical values in the in-scope set after this change ships.

Files outside the in-scope set (e.g. `package.json`, lockfiles, code-level constants) are NOT governed by this requirement and remain at whatever version their own workflow dictates.

#### Scenario: No stale versions remain

- **WHEN** the in-scope file set is scanned for `version:` frontmatter values
- **THEN** every match resolves to `0.1.0`, with no occurrences of `"2.0"`, `"1.0"`, or `0.3.0`

#### Scenario: package.json is not modified

- **WHEN** this change ships
- **THEN** `package.json`'s `version` field is unchanged
