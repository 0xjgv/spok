---
name: spok-simplify
description: Behavior-preserving simplification of the current chunk — remove duplication, unnecessary abstraction, and dead code inside the chunk's diff, prove behavior with re-run checks, and return a structured summary. Invoked by spok-flow between implement and validate.
argument-hint: <task-dir> (absolute path to the task directory containing plan.md and ticket.md)
license: MIT
metadata:
  author: spok
  version: "2.0"
---
# Simplify the Chunk Implementation

You are running inside `spok-flow`, after `implement` and before `validate`. The
implemented behavior is fixed; your job is to reduce the chunk to the least code
that keeps it. The `validate` step independently re-judges the result afterward,
so your report cannot substitute for validation — but every claim in it must
still be true.

## Steps

1. **Read the task context FULLY**:
   - The argument is the absolute path to the task directory. Read `plan.md` and
     `ticket.md` there for the intended behavior and the automated verification
     commands the plan names.
   - The chunk's changes are uncommitted working-tree edits — the `commit` step
     has not run. Establish the chunk's footprint with `git status --short` and
     `git diff` in the implementation repository.

2. **Bound the pass to the chunk**:
   - Edit only files the chunk already changed. Every edit must trace to a
     specific finding from step 3.
   - Do not refactor, reformat, or "clean up" code the chunk did not touch, even
     when it is bad. If removing duplication would require changing code outside
     the chunk's diff, leave the duplication in place and record it under
     `Remaining concerns`.

3. **Hunt for slop in the diff**. Before keeping or introducing any abstraction,
   search the repository for an existing one that already covers the concept —
   reuse beats reinvention. Look for:
   - logic or constants duplicated inside the diff, or between the diff and
     existing code
   - a parallel implementation of a concept the repository already has
   - helpers, wrappers, or indirection layers with a single caller and no
     semantic value
   - speculative parameters, branches, configuration, or compatibility paths no
     requirement asks for
   - defensive code (guards, fallbacks, try/catch) not backed by the plan or
     ticket
   - dead code, unused exports, or stale comments the chunk introduced
   - code that can be deleted instead of generalized

4. **Apply the objective**: preserve the validated behavior while minimizing
   concepts introduced, duplicate logic, public API surface, branching,
   indirection, dependencies, and total code.
   - A simplification pass must never leave the code more complex than it found
     it. When the only available change would add structure, skip it and record
     why under `Remaining concerns`.
   - A no-op is a valid outcome. If the implementation is already minimal,
     change nothing and say so — never churn code to have something to report.

5. **Prove behavior after your edits**:
   - Re-run the automated verification commands the plan names. Commands come
     from the repository's manifest or the plan — never from a toolchain guess.
   - If a check fails after a simplification, revert that simplification. Do not
     fix forward into new behavior — that is implementation work, and it belongs
     to `repair` or a new chunk.

6. **Stay in your lane**:
   - Do not create commits.
   - Do not edit task artifacts (`ticket.md`, `plan.md`, research, design, or
     validation documents).
   - Do not add dependencies.

## Output

Return a summary in this shape — `spok flow complete --summary` records it
permanently:

```
Behavior preserved:
- <exact command> — <actual result>
Changes made:
- <finding → edit, with file paths> (or "None — implementation already minimal.")
Structural impact:
- <net lines added/removed; public API changes; dependencies removed>
Remaining concerns:
- <duplication needing a broader refactor, complexity that could not be reduced, or "None.">
```

Do not claim a check passed without naming the exact command that ran. If you
changed nothing, state that no checks were re-run because no code changed.
