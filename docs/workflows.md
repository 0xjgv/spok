---
version: 0.1.0
---

# Workflows

This guide covers common workflow patterns for Spok. For basic setup, see [Getting Started](getting-started.md). For the command reference, see [Commands](commands.md).

## The core loop

Spok exposes exactly three slash commands, and they always run in the same order:

```text
/spok-propose <description>
     │
     ▼
/spok-apply     ← run once per chunk in tasks.md
     │
     ▼
/spok-archive   ← when every chunk is shipped
```

- **`/spok-propose`** scaffolds the change folder, creates the planning artifacts (proposal, specs, design), and writes a `tasks.md` that is a list of chunks. A chunk is one thin, end-to-end-testable slice of work.
- **`/spok-apply`** picks the first unchecked chunk, stages a ticket under `.flow/<chunk-slug>/`, runs research → design → plan → implement → review → commit on it via the vendored `spok-flow` skill, then flips the chunk's checkbox to `[x]`. One chunk per invocation.
- **`/spok-archive`** applies any delta specs to the main specs and moves the change into `spok/changes/archive/YYYY-MM-DD-<name>/`. Sync is folded in — there is no separate sync step.

That loop is the entire workflow. The patterns below are about how you sequence it across real-world situations.

---

## Pattern: small feature, fast path

You know what you want. You want it built.

```text
/spok-propose add-logout-button
/spok-apply        # chunk 1
/spok-apply        # chunk 2
/spok-archive
```

**Example conversation:**

```text
You: /spok-propose add-logout-button

AI:  Created spok/changes/add-logout-button/
     ✓ proposal.md
     ✓ specs/auth/spec.md
     ✓ design.md
     ✓ tasks.md (2 chunks)
     Run /spok-apply to ship the first chunk.

You: /spok-apply

AI:  Shipping chunk 1: Add logout endpoint + session clearing
     [research → design → plan → implement → review → commit]
     ✓ Chunk shipped.
     Remaining: 1/2. Next: Wire logout button to header.

You: /spok-apply

AI:  Shipping chunk 2: Wire logout button to header
     ✓ Chunk shipped.
     Remaining: 0/2. Run /spok-archive.

You: /spok-archive

AI:  ✓ Applied 1 ADDED requirement to spok/specs/auth/spec.md
     ✓ Moved to spok/changes/archive/2026-05-26-add-logout-button/
```

**Best for:** small to medium features, bug fixes, straightforward changes.

---

## Pattern: review and edit `tasks.md` before applying

You can — and should — sanity-check `tasks.md` after `/spok-propose` runs. The chunked format is plain Markdown:

```markdown
- [ ] 1. Add theme context + CSS variables
    **Slug:** theme-context-css-vars
    **Layers:** frontend
    **Prerequisites:** none
    **End-to-end test:** test/ui/theme-toggle.test.tsx
    **Rollback:** revert src/contexts/ThemeContext.tsx and globals.css

    <chunk body>

- [ ] 2. Wire toggle to localStorage
    **Slug:** wire-toggle-localstorage
    **Layers:** frontend
    **Prerequisites:** theme-context-css-vars
    ...
```

Common edits:

- Reorder chunks if you want a different shipping sequence.
- Tighten a chunk title or slug.
- Split one chunk into two if it's still too large to ship in a single `/spok-apply` invocation.
- Adjust `**Prerequisites:**` to reflect dependencies you spotted.

Don't pre-tick checkboxes — `/spok-apply` owns the checkbox flip and uses it to track progress.

---

## Pattern: parallel changes

Multiple changes can coexist under `spok/changes/`. Each one has its own `tasks.md` and `.flow/` ticket directory, so they don't collide.

```text
# Mid-implementation of add-dark-mode, an urgent bug shows up.

/spok-propose fix-login-redirect
/spok-apply
/spok-archive

# Resume the original change by naming it explicitly:
/spok-apply add-dark-mode
```

**Best for:** parallel work streams, urgent interrupts, team collaboration on different branches.

When `/spok-apply` is called without arguments and several active changes exist, the skill uses `spok list --json` and asks you to pick.

---

## Pattern: long-running change

A change can stay active across many sessions. Each `/spok-apply` invocation:

1. Reads `tasks.md` to find the first `- [ ]` chunk.
2. Stages a fresh ticket in `.flow/<chunk-slug>/`.
3. Runs the full flow loop for just that chunk.
4. Ticks the checkbox.

That means you can stop after any chunk and pick up later without remembering state. The unchecked boxes in `tasks.md` are the resumable queue.

If `/spok-flow` hits a blocker partway through a chunk, the checkbox stays `- [ ]`. Fix the blocker, then run `/spok-apply` again — it picks the same chunk up from a clean ticket.

---

## When to update a change vs. start a new one

A common question once a change is mid-flight.

**Update the existing change when:**

- Same intent, refined execution.
- Scope narrows (MVP first, rest later).
- Learning-driven corrections (the codebase isn't what you expected).
- Design tweaks discovered during implementation.

**Start a new change when:**

- Intent fundamentally changed.
- Scope exploded to different work entirely.
- The original change can be marked "done" standalone.
- A patch would obscure the history more than clarify it.

```text
                     ┌─────────────────────────────────────┐
                     │     Is this the same work?          │
                     └──────────────┬──────────────────────┘
                                    │
                 ┌──────────────────┼──────────────────┐
                 │                  │                  │
                 ▼                  ▼                  ▼
          Same intent?      >50% overlap?      Can original
          Same problem?     Same scope?        be "done" without
                 │                  │          these changes?
                 │                  │                  │
       ┌────────┴────────┐  ┌──────┴──────┐   ┌───────┴───────┐
       │                 │  │             │   │               │
      YES               NO YES           NO  NO              YES
       │                 │  │             │   │               │
       ▼                 ▼  ▼             ▼   ▼               ▼
    UPDATE            NEW  UPDATE       NEW  UPDATE          NEW
```

**Example: "Add dark mode"**

- "Need to also support custom themes" → New change (scope exploded).
- "System preference detection is harder than expected" → Update the existing design and chunks.
- "Let's ship the toggle first and add preferences later" → Update, archive, then a new change for preferences.

---

## Best Practices

### Keep changes focused

One logical unit of work per change. If you're doing "add feature X and also refactor Y," consider two separate changes.

**Why it matters:**

- Easier to review and understand.
- Cleaner archive history.
- Can ship independently.
- Simpler rollback if needed.

### Keep chunks thin

The chunking pass in `/spok-propose` tries to produce thin, end-to-end-testable chunks. If a chunk feels too big, split it in `tasks.md` before running `/spok-apply`. A good chunk:

- Touches whatever layers (db, backend, frontend, infra) it needs to make the slice observable.
- Has a single named end-to-end test.
- Has a one-line rollback.

### Name changes clearly

Good names make `spok list` useful.

```text
Good:                          Avoid:
add-dark-mode                  feature-1
fix-login-redirect             update
optimize-product-query         changes
implement-2fa                  wip
```

### Inject project context once, not every prompt

Put your tech stack, conventions, and non-obvious constraints in `spok/config.yaml` under `context:`. Spok injects that into every artifact instruction, so `/spok-propose` doesn't need to be reminded every time. See [Concepts](concepts.md#project-configuration) for the structure.

---

## Quick Reference

For full command details and options, see [Commands](commands.md).

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/spok-propose` | Create a change with chunked `tasks.md` | Start of every change |
| `/spok-apply` | Ship the next unchecked chunk | Once per chunk, repeat until done |
| `/spok-archive` | Apply delta specs and archive | Once at the end |

## Next Steps

- [Commands](commands.md) — Full command reference
- [Concepts](concepts.md) — Specs, changes, chunks, and how they fit together
- [Getting Started](getting-started.md) — Step-by-step first run
