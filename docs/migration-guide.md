# Migration Guide: Spok 0.x → 1.0

Spok 1.0 is a major breaking release. The surface area shrank from 17 CLI subcommands + 11 workflow skills down to a fixed three-verb workflow plus a small CLI for setup and bookkeeping. This guide is for projects upgrading from an earlier version of Spok.

If you're starting fresh, you can skip this and go directly to [Getting Started](getting-started.md).

## The headline change

The entire workflow is now three slash commands:

```text
/spok-propose <description>
/spok-apply          # one chunk per invocation, repeat until done
/spok-archive
```

`/spok-propose` writes `proposal.md`, `specs/`, `design.md`, and a chunked `tasks.md`. `/spok-apply` ships one unchecked chunk end-to-end through a vendored research → design → plan → implement → review → commit flow, then ticks the box. `/spok-archive` applies your delta specs and moves the change to `spok/changes/archive/`.

There is no `/opsx:*` namespace anymore. There is no profile system. There is no separate sync step.

## What disappeared

### Slash commands and skills

Everything in the `/opsx:*` namespace was removed. The workflow skills below also no longer exist.

| Removed | Replacement |
|---------|-------------|
| `/opsx:propose` | `/spok-propose` |
| `/opsx:apply` | `/spok-apply` |
| `/opsx:archive` | `/spok-archive` |
| `/opsx:sync` | Folded into `/spok-archive` (sync is unconditional) |
| `/opsx:explore` | No replacement — start with `/spok-propose` and iterate the artifacts |
| `/opsx:new` | Internal, now `spok new change` (called by `/spok-propose`) |
| `/opsx:continue` | No replacement — the chunked `tasks.md` from `/spok-propose` replaces incremental artifact creation |
| `/opsx:ff` | Folded into `/spok-propose` |
| `/opsx:verify` | No replacement — the `spok-flow` skill includes a review step per chunk |
| `/opsx:bulk-archive` | Run `/spok-archive` per change |
| `/opsx:onboard` | No replacement |

Retired skill directories that `spok init`/`spok update` will clean up:

- `spok-explore`
- `spok-new-change`
- `spok-continue-change`
- `spok-ff-change`
- `spok-sync-specs`
- `spok-bulk-archive-change`
- `spok-verify-change`
- `spok-onboard`
- `spok-feedback`
- `spok-apply-change` (renamed → `spok-apply`)
- `spok-archive-change` (renamed → `spok-archive`)

### CLI subcommands

These verbs were removed entirely:

| Removed | Notes |
|---------|-------|
| `spok view` | Interactive dashboard removed |
| `spok change` | Subtree removed |
| `spok validate` | Removed |
| `spok show` | Removed |
| `spok feedback` | Use GitHub issues directly |
| `spok completion` | Removed |
| `spok spec` | Removed |
| `spok config` | Edit `spok/config.yaml` directly |
| `spok schema` / `spok schemas` | Schemas are an internal concept; `spec-driven` is the only one |
| `spok workspace` | Removed — see note below |
| `spok experimental` | Removed |
| `spok templates` | Removed |

The surviving CLI surface is documented in [CLI](cli.md).

### Workspace planning layouts

If you still have a `.spok-workspace/` layout from an earlier version, Spok can resolve it for `spok status` and `spok instructions`. `/spok-apply` and `/spok-archive` require repo-local mode and will stop when `actionContext.mode` is `workspace-planning`. Migrate cross-repo work into a single repo or run apply/archive from each linked repo separately.

### Profiles and `--profile`

Previous Spok versions exposed a `core` profile and a `custom` profile selected via `spok config profile` and a global `--profile` flag. Both are gone. The three-verb surface is fixed; there is no longer anything to select. Any `--profile` flag in your scripts should be removed.

## The new `tasks.md` format

If you have an active change from a previous Spok version, its `tasks.md` likely looks like this:

```markdown
# Tasks

## 1. Theme Infrastructure
- [ ] 1.1 Create ThemeContext
- [ ] 1.2 Add CSS custom properties
- [ ] 1.3 Implement localStorage persistence
```

`/spok-apply` in 1.0 expects chunked checkboxes instead:

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

    <chunk body>

- [ ] 2. Wire toggle component to localStorage
    **Slug:** wire-toggle-localstorage
    ...
```

**Upgrade path for in-flight changes:**

1. Re-run `/spok-propose` against the same change name. It will scaffold the planning artifacts fresh and invoke `spok-create-scoped-chunks` to produce a chunked `tasks.md`.
2. Or, if you want to keep your existing proposal/specs/design, rewrite `tasks.md` by hand into the chunked format. Each chunk needs a slug, layers, prerequisites, end-to-end test, and a one-line rollback.

Already-completed work doesn't need to be re-shipped — once a chunk's checkbox is `- [x]`, `/spok-apply` skips it.

## Archive: sync is unconditional

In 0.x, `/opsx:archive` asked whether you wanted to sync delta specs before archiving.

In 1.0, `/spok-archive` syncs unconditionally. There is no separate `/opsx:sync` command and no prompt. If a change has delta specs, they are applied to the main specs as part of archiving.

If you've been syncing manually, just stop. Run `/spok-archive` when the change is done and let it handle the merge.

## Existing changes and archives

Active and archived changes from 0.x are preserved as-is.

- **`spok/changes/<name>/`** — Existing change folders work with the new skills. Re-run `/spok-propose` against the same name to get a chunked `tasks.md`, or hand-convert the existing one (see above).
- **`spok/changes/archive/`** — Untouched.
- **`spok/specs/`** — Untouched.
- **`spok/config.yaml`** — The `schema:`, `context:`, and `rules:` keys still work. Drop any `profile:` or workflow-selection keys.

## Running the cleanup

`spok init` and `spok update` both detect retired skill directories from old Spok versions and offer to clean them up.

```bash
# Update the package
bun add -g spok@latest

# Refresh the project (interactive cleanup if legacy files exist)
spok update
```

For CI or scripted environments:

```bash
spok update --force
```

This:

1. Removes retired skill directories (`spok-explore`, `spok-new-change`, etc.) under each tool's skills root.
2. Installs the three new user-facing skills (`spok-propose`, `spok-apply`, `spok-archive`).
3. Vendors the helper skill closure (`spok-flow`, `spok-create-scoped-chunks`, and the rest).

## Updated `config.yaml` shape

Spok 1.0 still uses `spok/config.yaml`. Drop any profile/workflow keys and stick with this shape:

```yaml
schema: spec-driven    # The only built-in schema

context: |
  Project background, tech stack, key constraints.
  Injected into every artifact instruction.

rules:
  proposal:
    - Include rollback plan
  specs:
    - Use Given/When/Then format
  design:
    - Document fallback strategies
  tasks:
    - Keep each chunk to a single end-to-end-testable slice
```

See [Customization](customization.md) for details.

## Common pitfalls

### "Command not found: /opsx:propose"

You're on the new version but your AI tool is still showing legacy commands. Run `spok update`, then restart your AI tool so it re-scans skills.

### "tasks.md not in chunk format"

You're trying to `/spok-apply` against an old-format `tasks.md`. Re-run `/spok-propose` against the same change name to regenerate it, or hand-convert as described above.

### Scripts still pass `--profile`

Remove the flag. There is no profile system anymore.

### Telemetry preferences

Telemetry settings (`SPOK_TELEMETRY`, `DO_NOT_TRACK`) are unchanged.

## Where to get help

- **Discord**: [discord.gg/YctCnvvshC](https://discord.gg/YctCnvvshC)
- **GitHub Issues**: [github.com/Fission-AI/Spok/issues](https://github.com/Fission-AI/Spok/issues)
- **Docs**: [Getting Started](getting-started.md), [Commands](commands.md), [CLI](cli.md), [Concepts](concepts.md)
