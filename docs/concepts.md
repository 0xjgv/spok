---
version: 0.1.0
---

# Concepts

This guide explains the core ideas behind Spok and how they fit together. For practical usage, see [Getting Started](getting-started.md) and [Workflows](workflows.md).

## Philosophy

Spok is built around four principles:

```
fluid not rigid         — no phase gates, work on what makes sense
iterative not waterfall — learn as you build, refine as you go
easy not complex        — lightweight setup, minimal ceremony
brownfield-first        — works with existing codebases, not just greenfield
```

### Why These Principles Matter

**Fluid not rigid.** Traditional spec systems lock you into phases: first you plan, then you implement, then you're done. Spok is more flexible — you can refine artifacts in any order that makes sense for your work.

**Iterative not waterfall.** Requirements change. Understanding deepens. What seemed like a good approach at the start might not hold up after you see the codebase. Spok embraces this reality.

**Easy not complex.** Some spec frameworks require extensive setup, rigid formats, or heavyweight processes. Spok stays out of your way. Initialize in seconds, start working immediately.

**Brownfield-first.** Most software work isn't building from scratch — it's modifying existing systems. Spok's delta-based approach makes it easy to specify changes to existing behavior, not just describe new systems.

## The Workflow Skill Surface

Spok ships four user-facing slash commands. Everything else is internal plumbing or vendored helper skills.

| Verb | Slash command | Skill name | Purpose |
|------|---------------|------------|---------|
| Explore | `/spok-explore` | `spok-explore` | Think through an idea, inspect context, and compare options without implementing |
| Propose | `/spok-propose` | `spok-propose` | Scaffold a change with proposal, specs, design, and a chunked `tasks.md` |
| Apply | `/spok-apply` | `spok-apply` | Ship one unchecked chunk from `tasks.md` end-to-end |
| Archive | `/spok-archive` | `spok-archive` | Apply delta specs to main specs and move the change to `archive/` |

These four skills are installed automatically by `spok init` and refreshed by `spok update`. The propose and apply skills delegate to a closure of vendored helper skills (`spok-flow`, `spok-create-scoped-chunks`, and others) that ship with the CLI.

## The Big Picture

Spok organizes your work into two main areas:

```
┌────────────────────────────────────────────────────────────────────┐
│                            spok/                                   │
│                                                                    │
│   ┌─────────────────────┐      ┌───────────────────────────────┐   │
│   │       specs/        │      │         changes/              │   │
│   │                     │      │                               │   │
│   │  Source of truth    │◄─────│  Proposed modifications       │   │
│   │  How your system    │ merge│  Each change = one folder     │   │
│   │  currently works    │      │  Contains artifacts + deltas  │   │
│   │                     │      │                               │   │
│   └─────────────────────┘      └───────────────────────────────┘   │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

**Specs** are the source of truth — they describe how your system currently behaves.

**Changes** are proposed modifications — they live in separate folders until you're ready to merge them.

This separation lets you work on multiple changes in parallel without conflicts, review a change before it touches the source of truth, and merge deltas cleanly when you archive.

## Specs

Specs describe your system's behavior using structured requirements and scenarios.

### Structure

```
spok/specs/
├── auth/
│   └── spec.md           # Authentication behavior
├── payments/
│   └── spec.md           # Payment processing
├── notifications/
│   └── spec.md           # Notification system
└── ui/
    └── spec.md           # UI behavior and themes
```

Organize specs by domain — logical groupings that make sense for your system. Common patterns:

- **By feature area**: `auth/`, `payments/`, `search/`
- **By component**: `api/`, `frontend/`, `workers/`
- **By bounded context**: `ordering/`, `fulfillment/`, `inventory/`

### Spec Format

A spec contains requirements, and each requirement has scenarios:

```markdown
# Auth Specification

## Purpose
Authentication and session management for the application.

## Requirements

### Requirement: User Authentication
The system SHALL issue a JWT token upon successful login.

#### Scenario: Valid credentials
- GIVEN a user with valid credentials
- WHEN the user submits login form
- THEN a JWT token is returned
- AND the user is redirected to dashboard

#### Scenario: Invalid credentials
- GIVEN invalid credentials
- WHEN the user submits login form
- THEN an error message is displayed
- AND no token is issued

### Requirement: Session Expiration
The system MUST expire sessions after 30 minutes of inactivity.

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 30 minutes pass without activity
- THEN the session is invalidated
- AND the user must re-authenticate
```

**Key elements:**

| Element | Purpose |
|---------|---------|
| `## Purpose` | High-level description of this spec's domain |
| `### Requirement:` | A specific behavior the system must have |
| `#### Scenario:` | A concrete example of the requirement in action |
| SHALL/MUST/SHOULD | RFC 2119 keywords indicating requirement strength |

### What a Spec Is (and Is Not)

A spec is a **behavior contract**, not an implementation plan.

Good spec content:

- Observable behavior users or downstream systems rely on
- Inputs, outputs, and error conditions
- External constraints (security, privacy, reliability, compatibility)
- Scenarios that can be tested or explicitly validated

Avoid in specs:

- Internal class/function names
- Library or framework choices
- Step-by-step implementation details
- Detailed execution plans (those belong in `design.md` or as chunks in `tasks.md`)

Quick test: if implementation can change without changing externally visible behavior, it likely does not belong in the spec.

### Keep It Lightweight: Progressive Rigor

Spok aims to avoid bureaucracy. Use the lightest level that still makes the change verifiable.

**Lite spec (default):**

- Short behavior-first requirements
- Clear scope and non-goals
- A few concrete acceptance checks

**Full spec (for higher risk):**

- Cross-team or cross-repo changes
- API/contract changes, migrations, security/privacy concerns
- Changes where ambiguity is likely to cause expensive rework

Most changes should stay in Lite mode.

## Changes

A change is a proposed modification to your system, packaged as a folder with everything needed to understand and implement it.

### Change Structure

```
spok/changes/add-dark-mode/
├── proposal.md           # Why and what
├── design.md             # How (technical approach)
├── tasks.md              # Chunked checklist
├── .spok.yaml            # Change metadata (schema, created date)
├── specs/                # Delta specs
│   └── ui/
│       └── spec.md       # What's changing in ui/spec.md
└── .flow/                # Per-chunk tickets written by /spok-apply
    └── theme-context-css-vars/
        └── ticket.md
```

Each change is self-contained. It has:

- **Artifacts** — documents that capture intent, design, and a chunked task list
- **Delta specs** — specifications for what's being added, modified, removed, or renamed
- **Per-chunk tickets** — created on demand by `/spok-apply` under `.flow/<chunk-slug>/`

### Why Changes Are Folders

Packaging a change as a folder has several benefits:

1. **Everything together.** Proposal, design, tasks, deltas, and per-chunk tickets live in one place.
2. **Parallel work.** Multiple changes can exist simultaneously without conflicting.
3. **Clean history.** When archived, changes move to `changes/archive/` with their full context preserved.
4. **Review-friendly.** A change folder is easy to review — open it, read the proposal, check the design, see the spec deltas.

## Artifacts

Artifacts are the documents within a change that guide the work.

### The Artifact Flow

```
proposal ──────► specs ──────► design ──────► tasks.md ──────► implement
    │               │             │              │                │
   why            what           how         chunks            /spok-apply
 + scope        changes       approach     to ship           (one chunk
                                                              at a time)
```

`/spok-propose` writes the first four artifacts. `/spok-apply` consumes `tasks.md` one chunk per invocation.

### Proposal (`proposal.md`)

The proposal captures **intent**, **scope**, and **approach** at a high level.

```markdown
# Proposal: Add Dark Mode

## Intent
Users have requested a dark mode option to reduce eye strain
during nighttime usage and match system preferences.

## Scope
In scope:
- Theme toggle in settings
- System preference detection
- Persist preference in localStorage

Out of scope:
- Custom color themes (future work)
- Per-page theme overrides

## Approach
Use CSS custom properties for theming with a React context
for state management. Detect system preference on first load,
allow manual override.
```

### Specs (delta specs in `specs/`)

Delta specs describe **what's changing** relative to the current specs. See [Delta Specs](#delta-specs) below.

### Design (`design.md`)

The design captures **technical approach** and **architecture decisions**.

````markdown
# Design: Add Dark Mode

## Technical Approach
Theme state managed via React Context to avoid prop drilling.
CSS custom properties enable runtime switching without class toggling.

## Architecture Decisions

### Decision: Context over Redux
Using React Context for theme state because:
- Simple binary state (light/dark)
- No complex state transitions
- Avoids adding Redux dependency

### Decision: CSS Custom Properties
Using CSS variables instead of CSS-in-JS because:
- Works with existing stylesheet
- No runtime overhead
- Browser-native solution
````

### Tasks (`tasks.md`)

`tasks.md` is a **chunked checklist**. Each top-level checkbox is one chunk — a thin, end-to-end-testable slice of work, including any layers (db, backend, frontend, infra) the slice needs to be observable.

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

    Introduce a ThemeContext provider, declare CSS variables on
    :root for light/dark palettes, and wire the provider into the
    React tree so children can read the current theme.

- [ ] 2. Wire toggle component to localStorage
    **Slug:** wire-toggle-localstorage
    **Layers:** frontend
    **Prerequisites:** theme-context-css-vars
    ...

- [ ] 3. Apply theme to remaining surfaces
    **Slug:** apply-theme-surfaces
    **Layers:** frontend
    **Prerequisites:** theme-context-css-vars
    ...
```

**Fields under each chunk:**

| Field | Meaning |
|-------|---------|
| `**Slug:**` | Stable kebab-case identifier used for `.flow/<slug>/` tickets |
| `**Layers:**` | Which layers are touched (db, backend, frontend, infra) |
| `**Prerequisites:**` | Slugs of other chunks that must ship first (`none` if independent) |
| `**End-to-end test:**` | The test that proves the slice works |
| `**Rollback:**` | One-line rollback plan |

`/spok-apply` finds the first `- [ ]` chunk, stages it as a ticket, runs the flow, and flips the box to `- [x]` on success.

## Chunks and the Flow Loop

A chunk is the unit of shipping. `/spok-apply` ships exactly one chunk per invocation by:

1. Reading `tasks.md` and picking the first `- [ ]` chunk.
2. Halting if a prerequisite is unchecked.
3. Staging a ticket at `<changeRoot>/.flow/<chunk-slug>/ticket.md` containing the chunk's title, slug, layers, end-to-end test, rollback, body, and pointers back to the change's proposal/specs/design.
4. Invoking the vendored `spok-flow` skill against that ticket directory. The flow skill drives **research → design → plan → implement → review → commit** for the chunk.
5. On success, flipping `- [ ]` to `- [x]` for that chunk's line.

This is intentionally one chunk per command call. You stay in control of the shipping cadence, you can inspect each commit, and you can stop after any chunk without losing state — the unchecked boxes in `tasks.md` are the resumable queue.

## Delta Specs

Delta specs are how a change describes modifications to existing behavior. Instead of restating an entire spec, deltas list operations.

### The Format

```markdown
# Delta for Auth

## ADDED Requirements

### Requirement: Two-Factor Authentication
The system MUST support TOTP-based two-factor authentication.

#### Scenario: 2FA enrollment
- GIVEN a user without 2FA enabled
- WHEN the user enables 2FA in settings
- THEN a QR code is displayed for authenticator app setup
- AND the user must verify with a code before activation

#### Scenario: 2FA login
- GIVEN a user with 2FA enabled
- WHEN the user submits valid credentials
- THEN an OTP challenge is presented
- AND login completes only after valid OTP

## MODIFIED Requirements

### Requirement: Session Expiration
The system MUST expire sessions after 15 minutes of inactivity.
(Previously: 30 minutes)

#### Scenario: Idle timeout
- GIVEN an authenticated session
- WHEN 15 minutes pass without activity
- THEN the session is invalidated

## REMOVED Requirements

### Requirement: Remember Me
(Deprecated in favor of 2FA. Users should re-authenticate each session.)
```

### Delta Sections

| Section | Meaning | What Happens on Archive |
|---------|---------|------------------------|
| `## ADDED Requirements` | New behavior | Appended to main spec |
| `## MODIFIED Requirements` | Changed behavior | Replaces existing requirement with the same header |
| `## REMOVED Requirements` | Deprecated behavior | Deleted from main spec |
| `## RENAMED Requirements` | Rename only | Header renamed per `FROM:` / `TO:` pairs, scenarios untouched |

### Why Deltas Instead of Full Specs

**Clarity.** A delta shows exactly what's changing. Reading a full spec rewrite, you'd have to diff it mentally against the current version.

**Conflict avoidance.** Two changes can touch the same spec file without conflicting, as long as they modify different requirements.

**Review efficiency.** Reviewers see the change, not the unchanged context. Focus on what matters.

**Brownfield fit.** Most work modifies existing behavior. Deltas make modifications first-class, not an afterthought.

## Project Configuration

`spok/config.yaml` lets you inject project context and per-artifact rules into every `/spok-propose` artifact generation.

```yaml
schema: spec-driven

context: |
  Tech stack: TypeScript, React, Node.js, PostgreSQL
  API style: RESTful, documented in docs/api.md
  Testing: Jest + React Testing Library
  We value backwards compatibility for all public APIs

rules:
  proposal:
    - Include rollback plan
    - Identify affected teams
  specs:
    - Use Given/When/Then format
    - Reference existing patterns before inventing new ones
  design:
    - Document fallback strategies
```

**How it's used:**

- `context:` is injected into the instructions for every artifact.
- `rules.<artifact-id>:` is injected only when that artifact is being generated.
- These are constraints for the AI, not content that ends up inside the artifact file.

`/spok-propose` fetches the merged template + context + rules for each artifact through `spok instructions <artifact> --change <name> --json` — you can run that command directly if you want to inspect what the skill sees.

## Archive

Archiving completes a change by applying its delta specs into the main specs and preserving the change for history.

### What Happens When You Archive

```
Before /spok-archive:

spok/
├── specs/
│   └── auth/
│       └── spec.md  ◄───────────────┐
└── changes/                         │
    └── add-2fa/                     │
        ├── proposal.md              │
        ├── design.md                │ apply deltas
        ├── tasks.md                 │
        └── specs/                   │
            └── auth/                │
                └── spec.md ─────────┘


After /spok-archive:

spok/
├── specs/
│   └── auth/
│       └── spec.md        # Now includes 2FA requirements
└── changes/
    └── archive/
        └── 2026-05-26-add-2fa/    # Preserved for history
            ├── proposal.md
            ├── design.md
            ├── tasks.md
            └── specs/
                └── auth/
                    └── spec.md
```

### The Archive Process

1. **Apply deltas.** Each delta spec section (ADDED/MODIFIED/REMOVED/RENAMED) is applied to the corresponding main spec. Sync is unconditional; there is no separate sync step.
2. **Move to archive.** The change folder moves to `changes/archive/` with a date prefix.
3. **Preserve context.** All artifacts remain intact in the archive — proposal, design, tasks, deltas, and `.flow/` tickets.

### Why Archive Matters

**Clean state.** Active changes (`changes/`) shows only work in progress. Completed work moves out of the way.

**Audit trail.** The archive preserves the full context of every change — the proposal explaining why, the design explaining how, the chunked tasks showing what shipped, and the per-chunk tickets the flow skill wrote.

**Spec evolution.** Specs grow organically as changes are archived. Each archive merges its deltas, building up a comprehensive specification over time.

## How It All Fits Together

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  SPOK FLOW                                   │
│                                                                              │
│   ┌────────────────┐                                                         │
│   │  0. EXPLORE    │  /spok-explore <topic>                                  │
│   │  (optional)    │  → thinking-only research before a proposal             │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  1. PROPOSE    │  /spok-propose <description>                            │
│   │                │  → proposal + specs + design + chunked tasks.md         │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐                                                         │
│   │  2. APPLY      │  /spok-apply (one chunk per call)                       │
│   │  (loop)        │  → research → design → plan → implement → review →     │
│   │                │     commit, then tick the box                           │
│   └───────┬────────┘                                                         │
│           │                                                                  │
│   repeat until tasks.md is fully ticked                                      │
│           │                                                                  │
│           ▼                                                                  │
│   ┌────────────────┐     ┌──────────────────────────────────────────────┐    │
│   │  3. ARCHIVE    │────►│  Delta specs applied to main specs           │    │
│   │                │     │  Change folder moves to archive/             │    │
│   └────────────────┘     │  Specs are now the updated source of truth   │    │
│                          └──────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**The virtuous cycle:**

1. Specs describe current behavior.
2. `/spok-explore` can clarify unclear ideas without changing code.
3. Changes propose modifications (as deltas) and slice the work into chunks.
4. `/spok-apply` ships chunks one at a time.
5. `/spok-archive` merges deltas into specs.
6. Specs now describe the new behavior.
7. The next change builds on the updated specs.

## Glossary

| Term | Definition |
|------|------------|
| **Artifact** | A document within a change (proposal, design, tasks, or delta specs) |
| **Archive** | The process of completing a change, applying its deltas, and moving it to `changes/archive/` |
| **Change** | A proposed modification to the system, packaged as a folder with artifacts |
| **Chunk** | One thin, end-to-end-testable slice of work; one top-level checkbox in `tasks.md` |
| **Delta spec** | A spec that describes changes (ADDED/MODIFIED/REMOVED/RENAMED) relative to current specs |
| **Domain** | A logical grouping for specs (e.g., `auth/`, `payments/`) |
| **Flow** | The research → design → plan → implement → review → commit loop the `spok-flow` skill runs per chunk |
| **Requirement** | A specific behavior the system must have |
| **Scenario** | A concrete example of a requirement, typically in Given/When/Then format |
| **Source of truth** | The `spok/specs/` directory, containing the current agreed-upon behavior |
| **Ticket** | The per-chunk `.flow/<chunk-slug>/ticket.md` file `/spok-apply` writes for `spok-flow` |

## Next Steps

- [Getting Started](getting-started.md) — Practical first steps
- [Workflows](workflows.md) — Patterns and when to use each
- [Commands](commands.md) — Full command reference
- [CLI](cli.md) — Terminal reference
