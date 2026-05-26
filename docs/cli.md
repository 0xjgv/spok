# CLI Reference

The Spok CLI (`spok`) is the terminal companion to the three slash commands. It has a small user-facing surface for setup and bookkeeping, plus a small set of internal plumbing verbs that the skills call into.

For slash commands, see [Commands](commands.md). For workflow patterns, see [Workflows](workflows.md).

## Summary

| Surface | Verbs | Purpose |
|---------|-------|---------|
| **User-facing** | `init`, `update`, `archive`, `list` | Setup, refresh, finalize, browse |
| **Internal plumbing** | `new`, `status`, `instructions` | Called by skills; safe to inspect, not meant for daily human use |

Spok also ships internal libraries (validation, artifact graphs, workflow schemas, workspace resolution) that power the commands above. These are not exposed as CLI verbs in 1.0 — see [Migration Guide](migration-guide.md) for removed commands like `validate`, `show`, and `completion`.

---

## Global Options

| Option | Description |
|--------|-------------|
| `--version`, `-V` | Show version number |
| `--no-color` | Disable color output |
| `--help`, `-h` | Display help for command |

---

## User-Facing Commands

### `spok init`

Initialize Spok in your project. Creates the folder structure, configures the AI tools you select, installs the three user-facing skills (`spok-propose`, `spok-apply`, `spok-archive`), and vendors the helper skill closure (`spok-flow`, `spok-create-scoped-chunks`, and the rest).

```
spok init [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory). Created if it does not exist. |

**Options:**

| Option | Description |
|--------|-------------|
| `--tools <list>` | Configure AI tools non-interactively. Use `all`, `none`, or a comma-separated list of tool IDs |
| `--force` | Auto-cleanup legacy files without prompting |

**Supported tool IDs (`--tools`):** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `forgecode`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `opencode`, `pi`, `qoder`, `lingma`, `qwen`, `roocode`, `trae`, `windsurf`

**Examples:**

```bash
# Interactive initialization
spok init

# Initialize in a specific directory
spok init ./my-project

# Non-interactive: configure for Claude and Cursor
spok init --tools claude,cursor

# Configure for all supported tools
spok init --tools all

# Skip prompts and auto-cleanup legacy files
spok init --force
```

**What it creates:**

```
spok/
├── specs/              # Your specifications (source of truth)
├── changes/            # Proposed changes
└── config.yaml         # Project configuration

.claude/skills/spok-propose/SKILL.md     # User-facing skills
.claude/skills/spok-apply/SKILL.md
.claude/skills/spok-archive/SKILL.md
.claude/skills/spok-flow/                # Vendored helper skills
.claude/skills/spok-create-scoped-chunks/
.claude/skills/spok-create-research/
... (and the rest of the helper closure)

# Plus equivalent paths for any other tools you selected.
```

See [Supported Tools](supported-tools.md) for each tool's exact skills path.

---

### `spok update`

Re-install the three user-facing skills and refresh the vendored helper skill closure. Run this after upgrading the `spok` package, or whenever you want to re-sync a project's skills with the installed CLI version.

```
spok update [path] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `path` | No | Target directory (default: current directory) |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Force update even when files are up to date |

**Examples:**

```bash
# Refresh skills after upgrading the package
bun add -g spok@latest
spok update

# Force a clean rewrite
spok update --force
```

`spok update` overwrites managed skill files but never touches `spok/specs/`, `spok/changes/`, or `spok/config.yaml`.

---

### `spok list`

List active changes or specs in your project.

```
spok list [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--specs` | List specs instead of changes |
| `--changes` | List changes (default) |
| `--sort <order>` | Sort by `recent` (default) or `name` |
| `--json` | Output as JSON (for skills and scripts) |

**Examples:**

```bash
# List active changes
spok list

# List all specs
spok list --specs

# JSON output for scripts
spok list --json
```

**Output (text):**

```
Active changes:
  add-dark-mode     UI theme switching support
  fix-login-bug     Session timeout handling
```

The `/spok-apply` and `/spok-archive` skills use `spok list --json` when the user has not specified a change and several active changes exist.

---

### `spok archive`

Archive a completed change and merge its delta specs into main specs. This is the same effect as the `/spok-archive` slash command, exposed as a CLI verb for scripts and CI.

```
spok archive [change-name] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Change to archive (prompts if omitted) |

**Options:**

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompts |
| `--skip-specs` | Skip spec merge (for infrastructure/tooling/doc-only changes) |
| `--no-validate` | Skip validation (requires confirmation) |

**Examples:**

```bash
# Interactive archive
spok archive

# Archive a specific change without prompts
spok archive add-dark-mode --yes

# Archive a tooling change that doesn't touch specs
spok archive update-ci-config --skip-specs
```

**What it does:**

1. Validates the change (unless `--no-validate`).
2. Prompts for confirmation (unless `--yes`).
3. Applies delta specs from `<changeRoot>/specs/<capability>/spec.md` to `spok/specs/<capability>/spec.md` (`ADDED`, `MODIFIED`, `REMOVED`, `RENAMED`).
4. Moves the change folder to `spok/changes/archive/YYYY-MM-DD-<name>/`.

---

## Internal Plumbing Commands

These verbs exist for the skills (`spok-propose`, `spok-apply`, `spok-archive`) and for scripts that need structured JSON. They are stable but not the recommended human entry point.

### `spok new change`

Scaffold a new change directory and `.spok.yaml` metadata file. Called by `/spok-propose` during scaffolding.

```
spok new change <name> [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name` | Yes | Kebab-case change name |

**Options:**

| Option | Description |
|--------|-------------|
| `--description <text>` | Description to add to README.md |
| `--goal <text>` | Workspace product goal to store with the change |
| `--areas <names>` | Comma-separated affected workspace link names |
| `--schema <name>` | Workflow schema to use (default: project config, then `spec-driven`) |

**Example:**

```bash
spok new change add-dark-mode --description "Add a dark mode toggle"
```

This creates:

```
spok/changes/add-dark-mode/
└── .spok.yaml    # Change metadata (schema, created date)
```

`/spok-propose` runs this for you. You only need to call it directly in scripts.

---

### `spok status`

Display artifact completion status for a change.

```
spok status [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (prompts if omitted) |
| `--schema <name>` | Schema override (auto-detected from change's `.spok.yaml`) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive status check
spok status

# Status for a specific change
spok status --change add-dark-mode

# JSON for skill consumption
spok status --change add-dark-mode --json
```

**Output (text):**

```
Change: add-dark-mode
Schema: spec-driven
Progress: 2/4 artifacts complete

[x] proposal
[ ] design
[x] specs
[-] tasks (blocked by: design)
```

**Output (JSON):**

```json
{
  "changeName": "add-dark-mode",
  "schemaName": "spec-driven",
  "isComplete": false,
  "applyRequires": ["tasks"],
  "planningHome": { "changesDir": "spok/changes" },
  "changeRoot": "spok/changes/add-dark-mode",
  "artifactPaths": { "specs": { "existingOutputPaths": ["specs/ui/spec.md"] } },
  "actionContext": { "mode": "repo-local", "allowedEditRoots": ["."] },
  "artifacts": [
    {"id": "proposal", "outputPath": "proposal.md", "status": "done"},
    {"id": "design", "outputPath": "design.md", "status": "ready"},
    {"id": "specs", "outputPath": "specs/**/*.md", "status": "done"},
    {"id": "tasks", "outputPath": "tasks.md", "status": "blocked", "missingDeps": ["design"]}
  ]
}
```

Skills use the JSON form to resolve paths (`planningHome.changesDir`, `changeRoot`, `artifactPaths`) without guessing.

---

### `spok instructions`

Return enriched instructions for creating an artifact or applying tasks. Used by `/spok-propose` to fetch templates, context, and rules for each artifact.

```
spok instructions [artifact] [options]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `artifact` | No | Artifact ID: `proposal`, `specs`, `design`, `tasks`, or `apply` |

**Options:**

| Option | Description |
|--------|-------------|
| `--change <id>` | Change name (required in non-interactive mode) |
| `--schema <name>` | Schema override |
| `--json` | Output as JSON |

**Special case:** Use `apply` as the artifact to get task-implementation instructions.

**Examples:**

```bash
# Get instructions for the next ready artifact
spok instructions --change add-dark-mode

# Get instructions for a specific artifact
spok instructions design --change add-dark-mode

# Get apply/implementation instructions
spok instructions apply --change add-dark-mode

# JSON for skill consumption
spok instructions design --change add-dark-mode --json
```

**Output includes:**

- The artifact's template content
- Project context from `spok/config.yaml` `context:`
- Content from already-completed dependency artifacts
- Per-artifact rules from `spok/config.yaml` `rules:`

---

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | Error (validation failure, missing files, etc.) |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SPOK_TELEMETRY` | Set to `0` to disable telemetry |
| `DO_NOT_TRACK` | Set to `1` to disable telemetry (standard DNT signal) |
| `NO_COLOR` | Disable color output when set |

---

## Related Documentation

- [Commands](commands.md) — AI slash commands (`/spok-propose`, `/spok-apply`, `/spok-archive`)
- [Workflows](workflows.md) — Common patterns and when to use each
- [Supported Tools](supported-tools.md) — Tool integrations and install paths
- [Getting Started](getting-started.md) — First-time setup
