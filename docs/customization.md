---
version: 0.1.0
---

# Customization

Spok 1.0 ships with a fixed four-skill surface (`/spok-explore`, `/spok-propose`, `/spok-apply`, `/spok-archive`) and one built-in workflow schema (`spec-driven`). The customization surface that remains is project-level configuration: telling Spok about your project so the artifacts it generates fit your conventions.

For commands, see [Commands](commands.md). For the CLI, see [CLI](cli.md).

## Project Configuration (`spok/config.toml`)

`spok/config.toml` is created during `spok init`. Existing `spok/config.yaml` and `spok/config.yml` files are still accepted for backward compatibility. It controls three things:

- **`context`** — A project description injected into every artifact instruction. Use this to encode tech stack, conventions, and non-obvious constraints.
- **`rules`** — Per-artifact rules injected only when that artifact is being generated.
- **`flow.self_learn`** — Optional post-commit workflow improvement review after `/spok-apply`.

### Example

```toml
schema = "spec-driven"

context = """
Tech stack: TypeScript, React, Node.js, PostgreSQL
API style: RESTful, documented in docs/api.md
Testing: Jest + React Testing Library
We value backwards compatibility for all public APIs
"""

[rules]
proposal = [
  "Include rollback plan",
  "Identify affected teams",
]
specs = [
  "Use Given/When/Then format",
  "Reference existing patterns before inventing new ones",
]
design = ["Document fallback strategies"]
tasks = ["Keep each chunk to a single end-to-end-testable slice"]

[flow]
self_learn = true
```

### How It Reaches the AI

When `/spok-propose` creates an artifact, the skill calls `spok instructions <artifact> --change <name> --json`. That response includes:

```xml
<context>
Tech stack: TypeScript, React, Node.js, PostgreSQL
...
</context>

<rules>
- Include rollback plan
- Identify affected teams
</rules>

<template>
[Built-in template for this artifact]
</template>
```

- **Context** appears for every artifact.
- **Rules** appear only for the matching artifact (e.g., `rules.proposal` only when generating `proposal.md`).

The AI uses these as constraints, not as content to copy into the artifact file.

### Inspecting the Resolved Instructions

To see exactly what the skill will receive:

```bash
spok instructions proposal --change my-change --json
```

This is also how you debug "the AI keeps ignoring my rules" — if the rule isn't in the JSON output, it's not reaching the model.

## What `context` Should Hold

Be selective. Context is injected into **every** artifact instruction, so trim it ruthlessly.

**Good candidates:**

- Tech stack (languages, frameworks, databases)
- Architectural patterns (monorepo, microservices, hexagonal, etc.)
- Non-obvious constraints ("we can't depend on library X because…")
- Conventions that often get ignored by default

**Move to `rules` instead:**

- Artifact-specific formatting ("use Given/When/Then in specs")
- Per-artifact checklists ("proposals must include a rollback plan")

**Leave out entirely:**

- General best practices the model already knows
- Verbose history that doesn't affect current work

## Multi-Language Output

To produce artifacts in a language other than English, put a directive in `context`. See [Multi-Language](multi-language.md) for examples.

```toml
context = """
Language: Portuguese (pt-BR)
All artifacts must be written in Brazilian Portuguese.

Tech stack: TypeScript, React, Node.js
"""
```

## What Was Removed in 1.0

If you used previous versions of Spok, several customization knobs no longer exist:

- **Workflow profiles (`core`, `custom`)** — Removed. The four-skill surface is fixed.
- **Custom schemas (`spok schema init`, `spok schema fork`, `spok schema validate`, `spok schema which`, `spok schemas`)** — Removed. `spec-driven` is the only schema and it's a CLI internal.
- **Workspace commands (`spok workspace …`)** — Removed. Existing `.spok-workspace/` layouts may still resolve for `spok status` and `spok instructions`, but `/spok-apply` and `/spok-archive` require repo-local mode.
- **Browsing/inspection (`spok view`, `spok show`, `spok validate`, `spok feedback`, `spok completion`, `spok templates`)** — Removed.

If you depended on any of these, see the [Migration Guide](migration-guide.md) for the upgrade path.

## See Also

- [Commands](commands.md) — Slash command reference
- [CLI](cli.md) — Terminal reference, including `spok instructions`
- [Multi-Language](multi-language.md) — Generating artifacts in other languages
- [Migration Guide](migration-guide.md) — Upgrading from previous versions
