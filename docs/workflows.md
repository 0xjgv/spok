---
version: 0.1.0
---

# Workflows

This guide covers common workflow patterns for Spok. For basic setup, see [Getting Started](getting-started.md). For the command reference, see [Commands](commands.md).

## The core loop

Spok exposes four user-facing workflow skills. `/spok-explore` is optional thinking before a proposal; the shipping loop still runs propose, apply, archive in order:

```text
/spok-explore <topic>   ← optional thinking-only exploration
     │
     ▼
/spok-propose <description>
     │
     ▼
/spok-apply     ← run once per chunk in tasks.md
     │
     ▼
/spok-archive   ← when every chunk is shipped
```

- **`/spok-explore`** helps investigate ideas, compare approaches, inspect Spok artifacts, and summarize findings without writing implementation code.
- **`/spok-propose`** scaffolds the change folder, creates the planning artifacts (proposal, specs, design), and writes a `tasks.md` that is a list of chunks. A chunk is one thin, end-to-end-testable slice of work.
- **`/spok-apply`** picks the first unchecked chunk, stages a ticket under `.flow/<chunk-slug>/`, runs research → cause check → design (gate) → outline → implement → simplify → review → commit on it via the vendored `spok-flow` skill, then flips the chunk's checkbox to `[x]`. One chunk per invocation. The design discussion is the one human gate; everything after it runs unattended, and the PR is the review point.
- **`/spok-archive`** applies any delta specs to the main specs and moves the change into `spok/changes/archive/YYYY-MM-DD-<name>/`. Sync is folded in — there is no separate sync step.

The patterns below are about how you sequence these skills across real-world situations.

The flow follows RPI: research questions → research → cause check → design
discussion → structure outline → implement → simplify → correctness review →
commit. The cause check writes `evidence/causal-paths.md` (or `N/A: no defect`
for new behavior); the design places the fix at the first wrong step it names.
The design discussion is the one human gate: every open design question comes to
you, each option stating the premise it rests on and whether that premise is
verified, and then you approve or request changes. Implementation runs in a
worktree, simplify stays inside the implementation allowlist, and the review must
record `verdict: PASS` in `review.md` before the commit.

Saved flows that contain a removed step (`plan`, `validate-problem`,
`design-review`, `validate`, `repair`, `self-learn`) are unsupported. The CLI
blocks them without rewriting their state or task documents. Start a new task
directory with `ticket.md` to use the current flow; keep the old directory as a
record. Finished flows load read-only.

The CLI names `structure-outline.md` in every implementation, simplification,
review, and commit prompt. An unrelated `plan.md` does not change that selection.

Retired helper skills (`spok-create-plan`, `spok-review-design`, `spok-self-learn`,
`spok-validate-implementation`, `spok-validate-problem`) are removed by
`spok update` from configured project tools and by `spok update --global` from
home-scoped tools. Custom skills are preserved.

---

## Lite path: interview, then execute

Two skills, no CLI state. The spec file is the state machine.

```text
/spok-interview <topic>     ← grill until a spec exists, slice it, you sign off
     │   writes spok/specs/<spec-title>.md
     ▼
/spok-execute <spec-title>  ← fresh session; one subagent per slice, no human gates
```

- **`/spok-interview`** asks questions until a fresh session could build without asking you anything. It writes Goal, Requirements, Non-goals, Constraints (including the project gate), Acceptance checks, and an ordered `## Slices` checklist. Each slice is one user-visible outcome with its own check. A cold-read subagent finds gaps; you answer them, then approve the spec.
- **`/spok-execute`** takes the first `[ ]` slice and hands it to a fresh subagent: locate code, write a short plan under the slice, failing test first, implement, run the slice check and the project gate, commit. Two fix attempts on a red check, then it stops. The slice flips to `[x] (<sha>)` or `[!]` with the exact error. A blocked slice stops the loop. When every slice is done, it runs the spec's acceptance checks and commits the spec status.

Lite specs are flat files (`spok/specs/<spec-title>.md`); `spok list --specs` and `spok validate` read only `spok/specs/<capability>/spec.md` directories and ignore them.

**When to use which:**

| Use lite | Use the full flow (`/spok-propose` → `/spok-apply`) |
| --- | --- |
| You can sign off on the whole spec up front | Design needs review between research and implementation |
| Slices are small and mostly independent | Chunks need model routing (claude/codex/hybrid) or resume across harnesses |
| One session can run all slices | You want proposal/design artifacts, delta specs, and archive |

To resume after a block: fix the cause, reset the slice to `[ ]`, and re-run `/spok-execute <spec-title>`.

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
     [research → cause check → design (gate) → outline → implement → simplify → review → commit]
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

Put your tech stack, conventions, and non-obvious constraints in `spok/config.toml` under `context`. Spok injects that into every artifact instruction, so `/spok-propose` doesn't need to be reminded every time. See [Concepts](concepts.md#project-configuration) for the structure.

### Keep repository rules in `spok/MEMORY.md`

`spok/MEMORY.md` is optional and presence-based: if the file exists, `spok flow next` inlines its rules into every step prompt. Nothing to configure.

Only lines matching the rule grammar are read — a slug in backticks, a dash, one imperative sentence:

```markdown
# Memory

Everything outside the rule lines is for humans and never reaches a prompt.

## Rules

- `flow-ts-first` — Read src/commands/workflow/flow.ts before editing step definitions.
- `plan-cites-lines` — When planning, cite file:line for every claim about existing code.
```

Headings, paragraphs, and notes are ignored by design, so the file can explain itself at any length. At most 20 rules are inlined; anything past the cap, plus any bullet that fails the grammar, is reported in `memoryWarning` rather than dropped silently.

Spok never writes `spok/MEMORY.md`. Adding a rule, and deleting one that stopped being true, stays yours.

---

## Quick Reference

For full command details and options, see [Commands](commands.md).

| Command | Purpose | When to Use |
|---------|---------|-------------|
| `/spok-explore` | Think through an idea without implementing | Before proposing unclear work |
| `/spok-propose` | Create a change with chunked `tasks.md` | Start of every change |
| `/spok-apply` | Ship the next unchecked chunk | Once per chunk, repeat until done |
| `/spok-archive` | Apply delta specs and archive | Once at the end |

## Next Steps

- [Commands](commands.md) — Full command reference
- [Concepts](concepts.md) — Specs, changes, chunks, and how they fit together
- [Getting Started](getting-started.md) — Step-by-step first run
