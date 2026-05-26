# Getting Started

This guide walks through your first change with Spok after you've installed and initialized it. For installation instructions, see the [main README](../README.md#quick-start).

## How It Works

Spok helps you and your AI coding assistant agree on what to build before any code is written, then ship it one thin slice at a time.

The flow is the same every time:

```text
/spok-propose  →  /spok-apply  →  ...  →  /spok-apply  →  /spok-archive
```

- `/spok-propose` writes the planning artifacts (proposal, specs, design) plus a chunked `tasks.md`.
- `/spok-apply` ships one chunk end-to-end and ticks its checkbox. Run it once per chunk.
- `/spok-archive` applies any delta specs to the main specs and moves the change into the archive folder.

## What `spok init` Creates

After running `spok init`, your project has this structure:

```
spok/
├── specs/                          # Source of truth
│   └── <domain>/
│       └── spec.md
├── changes/                        # Proposed changes (one folder per change)
│   └── <change-name>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md                # Chunked checklist
│       ├── specs/                  # Delta specs
│       │   └── <domain>/
│       │       └── spec.md
│       └── .flow/                  # Per-chunk tickets, written by /spok-apply
│           └── <chunk-slug>/
│               └── ticket.md
└── config.yaml                     # Project configuration (optional)
```

Plus the skills under your AI tool's skills directory, for example for Claude Code:

```
.claude/skills/spok-propose/SKILL.md
.claude/skills/spok-apply/SKILL.md
.claude/skills/spok-archive/SKILL.md
.claude/skills/spok-flow/                # Vendored helper closure
.claude/skills/spok-create-scoped-chunks/
.claude/skills/spok-create-research/
... (and the rest of the helper closure)
```

See [Supported Tools](supported-tools.md) for each tool's exact skills path.

**Two key directories:**

- **`specs/`** — The source of truth. These specs describe how your system currently behaves, organized by domain (e.g., `specs/auth/`, `specs/payments/`).
- **`changes/`** — Proposed modifications. Each change gets its own folder. When you archive a change, its delta specs merge into the main `specs/` directory.

## Understanding Artifacts

Each change folder contains artifacts that guide the work:

| Artifact | Purpose |
|----------|---------|
| `proposal.md` | The "why" and "what" — captures intent, scope, and approach |
| `specs/` | Delta specs showing ADDED/MODIFIED/REMOVED/RENAMED requirements |
| `design.md` | The "how" — technical approach and architecture decisions |
| `tasks.md` | Chunked checklist. One checkbox per shipping chunk. |

**Artifacts build on each other:**

```
proposal ──► specs ──► design ──► tasks.md (chunks) ──► /spok-apply
   ▲           ▲          ▲                              │
   └───────────┴──────────┴──────────────────────────────┘
            update as you learn
```

You can always go back and refine an earlier artifact as you learn more during implementation. `/spok-apply` reads from these files every time, so edits take effect on the next chunk.

## The Chunked `tasks.md` Format

`/spok-propose` invokes the `spok-create-scoped-chunks` skill which slices the work into independently-shippable chunks:

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

    <chunk body — what gets built, including any layer needed>

- [ ] 2. Wire toggle to localStorage
    **Slug:** wire-toggle-localstorage
    **Layers:** frontend
    **Prerequisites:** theme-context-css-vars
    ...
```

A chunk is one thin slice that goes all the way through the stack to a user-observable behavior. Each `/spok-apply` invocation handles exactly one chunk and ticks the box on success.

## How Delta Specs Work

Delta specs are how a change describes what's changing relative to your current specs. Format:

```markdown
# Delta for Auth

## ADDED Requirements

### Requirement: Two-Factor Authentication
The system MUST require a second factor during login.

#### Scenario: OTP required
- GIVEN a user with 2FA enabled
- WHEN the user submits valid credentials
- THEN an OTP challenge is presented

## MODIFIED Requirements

### Requirement: Session Timeout
The system SHALL expire sessions after 30 minutes of inactivity.
(Previously: 60 minutes)

## REMOVED Requirements

### Requirement: Remember Me
(Deprecated in favor of 2FA)
```

When you run `/spok-archive`:

1. `ADDED` requirements are appended to the main spec.
2. `MODIFIED` requirements replace the existing version (matched by `### Requirement:` header).
3. `REMOVED` requirements are deleted from the main spec.
4. `RENAMED` requirements rename per `FROM:` / `TO:` pairs.

The change folder moves to `spok/changes/archive/YYYY-MM-DD-<name>/` for audit history.

## Walkthrough: your first change

Let's add dark mode to an application.

### 1. Propose the change

```text
You: /spok-propose add-dark-mode

AI:  Created spok/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/ui/spec.md — delta requirements
     ✓ design.md — technical approach
     ✓ tasks.md — 3 chunks
     Run /spok-apply to ship the first chunk.
```

### 2. Inspect what was created

**proposal.md:**

```markdown
# Proposal: Add Dark Mode

## Intent
Users have requested a dark mode option to reduce eye strain
during nighttime usage.

## Scope
- Theme toggle in settings
- System preference detection
- Persist preference in localStorage

## Approach
Use CSS custom properties for theming with a React context
for state management.
```

**specs/ui/spec.md** (delta):

```markdown
# Delta for UI

## ADDED Requirements

### Requirement: Theme Selection
The system SHALL allow users to choose between light and dark themes.

#### Scenario: Manual toggle
- GIVEN a user on any page
- WHEN the user clicks the theme toggle
- THEN the theme switches immediately
- AND the preference persists across sessions
```

**tasks.md** (chunked):

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

- [ ] 2. Wire toggle component to localStorage
    **Slug:** wire-toggle-localstorage
    ...

- [ ] 3. Apply theme to remaining surfaces
    **Slug:** apply-theme-surfaces
    ...
```

If anything looks wrong, edit any of these files now. `/spok-apply` reads from them.

### 3. Ship chunks

```text
You: /spok-apply

AI:  Using change: add-dark-mode
     Shipping chunk 1: Add theme context + CSS variables
     [research → design → plan → implement → review → commit]
     ✓ Chunk shipped.
     Remaining: 2/3. Next: Wire toggle component to localStorage.

You: /spok-apply
AI:  Shipping chunk 2: Wire toggle component to localStorage
     ✓ Chunk shipped.
     Remaining: 1/3. Next: Apply theme to remaining surfaces.

You: /spok-apply
AI:  Shipping chunk 3: Apply theme to remaining surfaces
     ✓ Chunk shipped.
     Remaining: 0/3. Run /spok-archive.
```

Each invocation does one chunk, runs research → design → plan → implement → review → commit on it, and ticks the box.

### 4. Archive

```text
You: /spok-archive

AI:  Archiving add-dark-mode...
     ✓ Applied 1 ADDED requirement to spok/specs/ui/spec.md
     ✓ Moved to spok/changes/archive/2026-05-26-add-dark-mode/

     ## Archive Complete
     Change:       add-dark-mode
     Schema:       spec-driven
     Archived to:  spok/changes/archive/2026-05-26-add-dark-mode/
     Specs:        Synced 1 capability spec
```

The delta specs are now part of `spok/specs/ui/spec.md`. The change folder is preserved under `archive/` for history.

## Useful CLI commands

While the slash commands cover the daily workflow, the CLI is handy for inspection and scripting:

```bash
# List active changes
spok list

# Show artifact status for a change
spok status --change add-dark-mode

# Archive a change non-interactively (same effect as /spok-archive)
spok archive add-dark-mode --yes
```

See [CLI](cli.md) for the full reference.

## Next Steps

- [Workflows](workflows.md) — Patterns for parallel changes, long-running changes, and editing chunks before applying
- [Commands](commands.md) — Detailed reference for `/spok-propose`, `/spok-apply`, `/spok-archive`
- [Concepts](concepts.md) — Deeper background on specs, changes, deltas, and chunks
