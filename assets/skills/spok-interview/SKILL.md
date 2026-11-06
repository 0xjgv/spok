---
name: spok-interview
description: Interview the user until a build-ready spec exists, slice it into vertical slices, and hand it to /spok-execute in a fresh session. Use when the user does not yet know exactly what to build, or wants the lite Spok path instead of the full flow.
argument-hint: <topic> (optional; what the user wants to build)
license: MIT
metadata:
  author: spok
  version: "1.0"
---

# Spok Interview

The user does not yet know exactly what they want. Find out, write it down as a spec, slice it, and stop. Do not build.

## 1. Interview

Map the work as a **design tree**: every decision branches into the decisions that hang off it. Work the tree in **rounds**.

- The **frontier** is every decision whose prerequisites are settled: questions you can ask now without guessing at answers you have not heard.
- Ask the whole frontier each round through AskUserQuestion. One question per frontier decision, at most 4 per call; split a larger frontier across calls in the same round.
- Give 2–4 options, your recommended answer first, labeled "(Recommended)". "Other" takes the rest. The user may see only the dialog, so each question carries its own context. Use previews when options are artifacts: interfaces, schemas, file layouts.
- Facts are your job, never the user's. Look up anything the repo or tools can answer before you ask. Use a subagent only for a broad search.
- Decisions are the user's. Put each to them and wait.
- Each answered round reshapes the tree. Recompute the frontier and ask again.

The frontier is empty when a fresh session could build from the spec without asking the user anything. Confirm shared understanding through AskUserQuestion before writing.

## 2. Write the spec

Pick a short kebab-case `<spec-title>`. Write `spok/specs/<spec-title>.md`. The executing session sees only this file:

- **Goal**: the problem, who has it, the outcome. One paragraph.
- **Requirements**: numbered, each testable.
- **Non-goals**.
- **Constraints**: stack, interfaces, existing code to reuse (with paths), and the project gate command (for example `bun run check`, `npm test`, `make ci`). Look the gate up in the repo; ask only if none exists.
- **Acceptance checks**: commands or observations that prove the whole spec works.
- **Slices**: see step 3.

## 3. Slice

Cut the requirements into ordered vertical slices under `## Slices`. Each slice:

- delivers one user-visible outcome, end to end across every layer it needs;
- has its own acceptance check: a command that fails before the slice and passes after;
- is independently committable: the project gate stays green after it lands;
- depends only on slices above it.

Format each slice as an unchecked item:

```markdown
## Slices

- [ ] S1: <user-visible outcome>
  - Requirements: R1, R3
  - Check: `<command>`
- [ ] S2: <user-visible outcome>
  - Requirements: R2
  - Check: `<command>`
```

Every requirement maps to at least one slice. Prefer 2–6 slices. A slice that needs a paragraph to describe is two slices.

## 4. Cold-read test

Spawn a fresh subagent with only the spec path:

> Read `<spec path>`. List every question you would need answered before building it, slice by slice. Flag any slice that is not vertical, lacks a runnable check, or depends on a later slice. Return `none` if there is nothing.

Put each question to the user through AskUserQuestion as in step 1. Update the spec. Repeat until the subagent returns `none`.

## 5. Sign off and hand off

The spec is the human gate: `/spok-execute` runs every slice without asking. Ask the user to approve the spec through AskUserQuestion. On approval, print the spec path and:

    Start a fresh session and run: /spok-execute <spec-title>

Stop.
