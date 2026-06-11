---
version: 0.1.0
---

# Commands

This is the reference for Spok's user-facing slash commands. These commands are invoked in your AI coding assistant's chat interface (e.g., Claude Code, Cursor, Windsurf).

For workflow patterns, see [Workflows](workflows.md). For CLI commands, see [CLI](cli.md).

## The workflow skill surface

Spok exposes four user-facing slash commands. Each one is backed by a skill of the same name (`spok-explore`, `spok-propose`, `spok-apply`, `spok-archive`). The skills are installed automatically by `spok init` and refreshed by `spok update`.

| Command | Purpose |
|---------|---------|
| `/spok-explore` | Think through an idea, compare options, and inspect context without implementing |
| `/spok-propose` | Scaffold a new change: proposal, specs, design, and a chunked `tasks.md` |
| `/spok-apply` | Ship the next unchecked chunk from `tasks.md` end-to-end |
| `/spok-archive` | Apply delta specs to main specs and move the change into the archive |

Use `/spok-explore` before proposing when the direction is still unclear. The shipping loop still follows the same order every time:

```text
/spok-explore <topic>   # optional thinking-only exploration
/spok-propose <description>
/spok-apply        # chunk 1
/spok-apply        # chunk 2
...
/spok-archive
```

If an agent is unsure about the installed CLI surface, it can run `spok capabilities --json` as a self-discovery escape hatch. The four slash commands above remain the normal workflow.

---

## Command Reference

### `/spok-explore`

Explore an idea before turning it into a proposed change. This is a thinking-only mode: the agent may read files, inspect Spok artifacts, compare options, and summarize findings, but it must not write implementation code or change source files.

**Syntax:**
```text
/spok-explore [topic-or-change]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `topic-or-change` | No | Idea, problem, active change name, comparison, or question to explore. If omitted, the skill asks what to investigate. |

**What it does:**

1. Clarifies what you want to understand.
2. Reads existing Spok context when useful, including active changes and their artifacts.
3. Searches and reads the codebase to ground the discussion.
4. Compares options, trade-offs, risks, and open questions.
5. Offers to capture decisions in artifacts only with your consent.

**Example:**
```text
You: /spok-explore should settings live in localStorage or server state?

AI:  Reads the current settings code, compares both options, and summarizes the trade-offs.
     No files are changed.
```

---

### `/spok-propose`

Create a new change and produce its planning artifacts plus a chunked `tasks.md`.

**Syntax:**
```text
/spok-propose [name-or-description]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `name-or-description` | No | Kebab-case name (`add-dark-mode`) or plain-language description. If omitted, the skill asks. |

**What it does:**

1. Derives a kebab-case change name from your input if needed.
2. Runs `spok new change <name>` to scaffold `spok/changes/<name>/` with `.spok.yaml`.
3. Walks the artifact graph (`spok status --change <name> --json`) and creates `proposal.md`, `specs/`, and `design.md` in dependency order, using `spok instructions <artifact> --change <name> --json` for templates and context.
4. Invokes the `spok-create-scoped-chunks` skill (`Skill({skill: "spok-create-scoped-chunks", args: "<name>"})`), which slices the design into cross-layer chunks and writes a single `tasks.md`.
5. Reports the chunk count and prompts you to run `/spok-apply`.

**Example:**
```text
You: /spok-propose add-dark-mode

AI:  Created spok/changes/add-dark-mode/
     ✓ proposal.md
     ✓ specs/ui/spec.md
     ✓ design.md
     ✓ tasks.md (3 chunks)
     Run /spok-apply to ship the first chunk.
```

**Chunked tasks.md format:**

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

    <chunk body>

- [ ] 2. Wire toggle to localStorage
    ...
```

Each top-level checkbox is one chunk: a thin, end-to-end-testable slice of work, including any layer (db, backend, frontend, infra) needed to make that slice observable.

**Tips:**
- Use a clear description so the chunking pass has enough context.
- You can edit `tasks.md` after propose finishes — for example, to reorder chunks or rewrite a slug.
- Don't pre-tick checkboxes. `/spok-apply` ticks them as chunks ship.

---

### `/spok-apply`

Ship exactly one unchecked chunk from `tasks.md` end-to-end.

**Syntax:**
```text
/spok-apply [change-name]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to apply against. Inferred from context, or chosen interactively if multiple active changes exist. |

**What it does:**

1. Selects the change (argument, conversation context, or interactive pick via `spok list --json`).
2. Reads `spok status --change <name> --json` to resolve the change root and confirm apply is allowed in this scope.
3. Parses `tasks.md` and finds the first chunk whose checkbox is `- [ ]`.
4. Halts if the chunk's `**Prerequisites:**` field references slugs that are still unchecked.
5. Stages a ticket at `<changeRoot>/.flow/<chunk-slug>/ticket.md` containing the chunk title, slug, layers, end-to-end test, rollback note, body, and pointers to the change's proposal, specs, and design.
6. Invokes the vendored `spok-flow` skill (`Skill({skill: "spok-flow", args: "<absolute-ticket-dir>"})`), which drives research → design → plan → implement → review → commit on just that chunk.
7. On success, flips `- [ ]` to `- [x]` for the chunk's line only. On failure, leaves the box unchecked and surfaces the error.
8. Prints remaining chunk count and the next chunk title.

**Example:**
```text
You: /spok-apply

AI:  Using change: add-dark-mode
     Shipping chunk 1: Add theme context + CSS variables
     [research → design → plan → implement → review → commit]
     ✓ Chunk shipped: Add theme context + CSS variables

     Remaining: 2/3 unchecked
     Next: Wire toggle to localStorage (run /spok-apply again)
```

**Guardrails:**

- Exactly one chunk per invocation. The skill does not loop.
- Only the chunk's leading checkbox is mutated; chunk bodies are never rewritten.
- If `tasks.md` is missing, the skill tells you to run `/spok-propose` first.
- If a chunk lacks a slug or body, the skill halts and asks you to fix `tasks.md`.

---

### `/spok-archive`

Finalize a completed change. Sync is folded into archive — delta specs are applied unconditionally.

**Syntax:**
```text
/spok-archive [change-name]
```

**Arguments:**

| Argument | Required | Description |
|----------|----------|-------------|
| `change-name` | No | Which change to archive. Prompted if ambiguous. |

**What it does:**

1. Selects the change (argument, conversation context, or interactive pick).
2. Runs `spok status --change <name> --json`. If any artifact is not `done`, warns and asks you to confirm.
3. Reads `tasks.md` and warns if any chunks remain unchecked.
4. Applies every delta spec under `<changeRoot>/specs/<capability>/spec.md` to the matching `spok/specs/<capability>/spec.md`:
   - `## ADDED Requirements` are appended.
   - `## MODIFIED Requirements` replace the existing requirement with the same `### Requirement:` header.
   - `## REMOVED Requirements` are deleted (optionally leaving a `<!-- removed: <reason> -->` marker).
   - `## RENAMED Requirements` rename per `FROM:` / `TO:` pairs.
   - If the main spec does not exist for a capability, the delta body becomes the new main spec.
5. Moves the change directory to `spok/changes/archive/YYYY-MM-DD-<name>/`.
6. Prints a per-capability summary of what was synced.

**Example:**
```text
You: /spok-archive

AI:  Archiving add-dark-mode...
     ✓ Applied 2 ADDED requirements to spok/specs/ui/spec.md
     ✓ Moved to spok/changes/archive/2026-05-26-add-dark-mode/

     ## Archive Complete
     Change:       add-dark-mode
     Schema:       spec-driven
     Archived to:  spok/changes/archive/2026-05-26-add-dark-mode/
     Specs:        Synced 1 capability spec
```

**Tips:**

- Archive never asks "do you want to sync?" — sync is always part of archive.
- Archive will not block on incomplete artifacts or chunks; it will only warn and confirm.
- If a same-day archive folder already exists for the same change name, archive fails with a clear error so you can rename or delete the existing one.

---

## Command Syntax by AI Tool

Different AI tools surface slash commands slightly differently. The intent is the same — only the prefix changes.

| Tool | How to invoke |
|------|----------------|
| Claude Code | `/spok-explore`, `/spok-propose`, `/spok-apply`, `/spok-archive` |
| Cursor | `/spok-explore`, `/spok-propose`, `/spok-apply`, `/spok-archive` |
| Windsurf | `/spok-explore`, `/spok-propose`, `/spok-apply`, `/spok-archive` |
| Copilot (IDE) | `/spok-explore`, `/spok-propose`, `/spok-apply`, `/spok-archive` |
| Kimi CLI | Skill-based invocations such as `/skill:spok-explore` |
| Trae | Skill-based invocations such as `/spok-explore` |

> **Note:** GitHub Copilot prompt files (`.github/prompts/*.prompt.md`) are only available in IDE extensions (VS Code, JetBrains, Visual Studio). GitHub Copilot CLI does not currently support custom prompt files — see [Supported Tools](supported-tools.md) for details and workarounds.

---

## Vendored Helper Skills

`/spok-propose` and `/spok-apply` delegate the heavy lifting to vendored helper skills that ship with the CLI. You don't invoke these directly, but they live alongside the user-facing skills (under `<tool-skills-dir>/skills/`) and are refreshed by `spok update`.

| Skill | Used by | Purpose |
|-------|---------|---------|
| `spok-flow` | `/spok-apply` | Drives research → design → plan → implement → review → commit for a single ticket |
| `spok-create-scoped-chunks` | `/spok-propose` | Slices a design into cross-layer chunks and writes `tasks.md` |
| `spok-create-research-questions` | `spok-flow` | Generates research questions from a ticket |
| `spok-create-research` | `spok-flow` | Executes research against the codebase |
| `spok-create-design-discussion` | `spok-flow` | Opens a design discussion for the chunk |
| `spok-create-structure-outline` | `spok-flow` | Produces a structure outline before a plan |
| `spok-create-plan` | `spok-flow` | Converts the outline into a detailed plan |
| `spok-implement-plan` | `spok-flow` | Phased implementation of the plan |
| `spok-code-review` | `spok-flow` | Reviews the diff |
| `spok-validate-implementation` | `spok-flow` | Validates implementation against the plan |
| `spok-ci-commit` | `spok-flow` | Commits the chunk with a conventional message |

These are intentionally co-located with the user-facing skills so the closure travels with the tool. Don't edit them in-place; they are overwritten on `spok update`.

---

## Troubleshooting

### "Change not found"

The command couldn't identify which change to work on.

- Specify the change name: `/spok-apply add-dark-mode`.
- Check active changes: `spok list`.
- Verify you're in the right project directory.

### "tasks.md is missing"

`/spok-apply` was invoked before `/spok-propose` produced a chunked checklist.

- Run `/spok-propose <name-or-description>` first.

### "Chunk has unmet prerequisites"

The first unchecked chunk in `tasks.md` lists a `**Prerequisites:**` slug that is still unchecked elsewhere.

- Re-order chunks in `tasks.md` so the prerequisite chunk comes first, or remove the prerequisite if it no longer applies.

### Commands not recognized

Your AI tool doesn't see the Spok skills.

- Ensure Spok is initialized: `spok init`.
- Regenerate skills: `spok update`.
- Confirm the tool's skills directory exists (e.g., `.claude/skills/spok-propose/SKILL.md`).
- Restart your AI tool so it re-scans skills.

### Artifacts feel generic

The AI is producing weak artifacts.

- Add project context in `spok/config.yaml` under `context:` — this is injected into every artifact instruction.
- Add per-artifact rules under `rules:` (`proposal:`, `specs:`, `design:`, `tasks:`).
- Provide a clearer description when you call `/spok-propose`.

---

## Next Steps

- [Workflows](workflows.md) — Common patterns and when to use each command
- [CLI](cli.md) — Terminal commands for setup, status, and archive
- [Concepts](concepts.md) — Deep dive into specs, changes, and chunks
