---
name: spok-create-scoped-chunks
description: break a medium/large change into cross-layer, independently shippable chunks. emits a single tasks.md checklist that spok-apply can iterate through.
argument-hint: <change-slug> (the Spok change slug pre-staged by spok-propose)
---

# Create Scoped Chunks

Take the change that `spok-propose` has already scaffolded under `spok/changes/<change-slug>/` and slice it into N cross-layer, independently shippable chunks. The chunk list is written as a single `tasks.md` file in checkbox form; `spok-apply` later picks unchecked chunks one at a time and runs them through `spok-flow`.

> Terminology: this skill uses "chunk" externally (the user's word). Internally, a chunk is the same thing `spok-create-structure-outline` calls a vertical "slice" — one user-observable behavior wired end-to-end across layers.

This skill **stops after writing `tasks.md`**. It does not fan out execution. `spok-apply` picks which chunk to ship next.

## 0. Receive the change slug

The argument to this skill is `<change-slug>`, pre-staged by `spok-propose`. The change directory `spok/changes/<change-slug>/` already exists and contains the proposal, specs, and design notes.

- Read `spok/changes/<change-slug>/proposal.md` and any sibling `specs/*.md` / `design.md` using the **Read** tool WITHOUT `limit`/`offset` to ground your chunking decisions.
- Do NOT create a parent task directory. The change directory is the parent.

## 1. Read mentioned files

Mirror `spok-create-research` step 1 (see `skills/spok-create-research/SKILL.md`):

- If the user's description mentions specific files (docs, JSON, tickets), read them FULLY first using the **Read** tool WITHOUT `limit`/`offset`.
- Read these files yourself in the main context before spawning any sub-agents.

## 2. Decompose for chunkability

Mirror `spok-create-research` step 2, but the goal is different — you are not "understanding the system," you are looking for **cut points**. Specifically identify:

- **Seams** between layers (db ↔ backend ↔ frontend ↔ infra) where work can be split.
- **Layers touched** for each piece of functionality.
- **Prerequisite chains** — what must exist before what.
- **Feature-flag opportunities** that let a chunk merge without exposing half-built behavior.

## 3. Spawn parallel sub-agents

Mirror `spok-create-research` step 3:

- Use the **Agent** tool to launch `codebase-locator`, `codebase-analyzer`, and `codebase-pattern-finder` agents in parallel, **foreground only**.
- Combine related questions into a single sub-agent prompt. Aim for 2–6 well-scoped sub-agents, not 1:1 question-to-agent.
- Tell each sub-agent what you're looking for; they know how to search.

## 4. Synthesize a chunkability map

Mirror `spok-create-research` step 4 — wait for ALL sub-agents to complete, then synthesize into a **chunkability map**:

- Layers touched per area, with `file:line` pointers.
- Natural seams discovered (e.g., "the API contract at `routes/foo.ts:42` is a clean cut").
- Dependency edges (A must ship before B because…).
- Feature-flag candidates.

## 5. Propose chunks against quality gates

Each candidate chunk must satisfy ALL of:

- **One user-observable behavior** — name it as a sentence a PM would recognize. Not "refactor X," not "add table Y."
- **Cross-layer scope** — touches ≥2 of {db, backend, frontend, infra}.
- **End-to-end test** — name the specific test file/path that proves it works. "Type-check passes" does not count.
- **Independently shippable** — could merge alone (behind a feature flag if needed) without breaking the app.
- **Prerequisites listed** — references to earlier chunk slugs. The full graph must be a DAG (no cycles).
- **Reversible** — one-line rollback (revert the PR, flip the flag off, drop the column, etc.).

Present chunks to the user as plain markdown — chunk list + dependency edges. Iterate based on feedback.

> Per `spok-create-structure-outline`: interpret ALL user feedback as instructions to update the proposal, not to begin implementation. If the user pushes back on a chunk, re-derive cut points; don't just rename.

## 6. Materialize as `tasks.md`

Once the user accepts the chunk set, write a single `spok/changes/<change-slug>/tasks.md` with the chunk list in checkbox form. `spok-apply` consumes this format: one `- [ ] N. <chunk title>` per chunk, with the chunk body indented beneath.

Use this exact shape (indentation matters — chunk body must be indented under the checkbox line):

````markdown
# Tasks — <change-slug>

- [ ] 1. <chunk-1 title — one user-observable behavior>
    **Slug:** <chunk-1-slug>
    **Layers:** <e.g., db, backend, frontend>
    **Prerequisites:** <list of prior chunk slugs or "none">
    **End-to-end test:** <test file path or description>
    **Rollback:** <one-line rollback>

    <chunk body — what to build, where, with file:line pointers as available>

- [ ] 2. <chunk-2 title>
    ...
````

Do NOT create per-chunk directories. `spok-apply` will stage each chunk's `ticket.md` on demand when it invokes `spok-flow`.

## 7. Stop — hand control back

- Read the final answer template:

  `Read({SKILLBASE}/references/chunks_final_answer.md)`

- Respond to the user following that template, but reference `spok/changes/<change-slug>/tasks.md` (not the legacy per-chunk directories).
- Do NOT invoke `spok-flow` or `spok-apply`. The user (or `spok-apply` on the next invocation) picks which chunk to ship next.

<guidance>
## Anti-patterns to reject

If your candidate chunk fits any of these, it's wrong — re-cut:

- **All-db chunk** ("add table X, no callers"). Not user-observable.
- **All-frontend chunk** ("add UI that doesn't talk to anything").
- **Flag-only chunk** ("introduce the flag, no behavior behind it").
- **Refactor-first chunk** ("clean up the module before doing the work"). Bundle the refactor into the chunk that needs it, or skip it.
- **"Type-check passes" as e2e test.** Type-checking is not behavior validation.

## When the task is too small to chunk

If the description touches <2 layers or is <1 day of work, say so explicitly and tell the user to invoke `hl-commit-agents` directly. Do not force a single-chunk plan.

## Cloud Permalinks

When you write or edit documents in `.humanlayer/tasks/`, a cloud permalink is automatically provided in the hook response.
- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations.
- Use this permalink in your final output for easy navigation.
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`

## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like ticket templates or SKILL.md examples), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example ticket
## Description
```text
some content
```
````
</guidance>
