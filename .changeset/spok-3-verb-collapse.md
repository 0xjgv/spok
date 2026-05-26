---
"@fission-ai/openspec": major
---

### Breaking Changes — Spok 3-Verb Collapse

Spok now ships a single, focused workflow: **propose → apply → archive**.

#### Removed slash commands and skills

The following skills and their `/opsx:*` / `/spok-*-change` slash commands no longer exist:

- `spok-explore`
- `spok-new-change`
- `spok-continue-change`
- `spok-ff-change`
- `spok-sync-specs`
- `spok-bulk-archive-change`
- `spok-verify-change`
- `spok-onboard`
- `spok-feedback`
- `spok-apply-change` → renamed to `spok-apply`
- `spok-archive-change` → renamed to `spok-archive`

The `/opsx:*` namespace is retired. The three user-facing skills are now `/spok-propose`, `/spok-apply`, and `/spok-archive`. Existing installations are auto-cleaned by `spok update`.

#### Removed CLI subcommands

The following `spok` subcommands have been removed:

`view`, `change`, `validate`, `show`, `feedback`, `completion`, `spec`, `config`, `schema`, `workspace`, `experimental`, `templates`, `schemas`

The CLI surface is now four user-facing verbs (`init`, `update`, `archive`, `list`) plus four internal plumbing verbs the skills depend on (`new`, `status`, `instructions`, `__complete`).

#### Removed profile system

The `core` / `custom` profile concept and the `--profile` flag are gone. `spok init` now always installs the three-verb surface. Project-level configuration (`context:` and `rules:`) is unaffected.

### New Features

- **Vendored skill closure.** `spok init` and `spok update` now copy a fixed set of helper skills (`spok-flow`, `spok-create-scoped-chunks`, and 9 transitive helpers) into each configured tool's skills directory. These are referenced by the three user skills via `Skill({skill: "..."})` invocations.
- **Chunked `tasks.md`.** `/spok-propose` now delegates task-list generation to `spok-create-scoped-chunks`, which produces a list of vertically-sliced chunks with explicit slug / layers / prerequisites / end-to-end test / rollback metadata.
- **Single-chunk apply.** `/spok-apply` picks the first unchecked chunk, stages a flow ticket under `.flow/<chunk-slug>/ticket.md`, hands off to `spok-flow`, and ticks the box on success. Run it again to advance to the next chunk.
- **Unconditional sync on archive.** `/spok-archive` now applies delta spec operations (ADDED / MODIFIED / REMOVED / RENAMED Requirements) unconditionally before moving the change to `spok/changes/archive/YYYY-MM-DD-<slug>/`. The separate `sync-specs` step is gone.
- **Subagent probe.** On Claude Code installs, `spok init` / `spok update` warns when a recommended custom subagent (e.g. `implementer-agent`) is missing from `~/.claude/agents/`.
- **Auto-cleanup on update.** Running `spok update` against a project from a prior version removes retired skill directories from each configured tool automatically.

### Migration

See `docs/migration-guide.md` for the upgrade path. In short:

1. Run `spok update` in each project — it removes retired skills and installs the new three-verb surface plus vendored helpers.
2. Adjust any in-flight `tasks.md` files to the new chunked format if you want them picked up by `/spok-apply`. Archived changes are unaffected.
3. Remove any `--profile` flags or references to retired CLI subcommands from scripts.
