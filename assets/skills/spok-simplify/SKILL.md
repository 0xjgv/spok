---
name: spok-simplify
description: Behavior-preserving simplification of the current chunk — remove duplication, unnecessary abstraction, and dead code inside the exact implementation allowlist, prove behavior with re-run checks, and return a structured summary. Invoked by spok-flow between implement and review.
argument-hint: <task-dir> (absolute task directory; the CLI selects the implementation artifact)
license: MIT
metadata:
  author: spok
  version: "2.1"
---
# Simplify the Chunk Implementation

You are running inside `spok-flow`, after `implement` and before `review`. The
implemented behavior is fixed; your job is to reduce the chunk to the least code
that keeps it. Preserve observable behavior and public interfaces. The `review`
step independently judges correctness afterward, so your report cannot substitute
for review — but every claim in it must still be true.

## Steps

1. **Read the task context FULLY**:
   - The argument is the absolute path to the task directory. Read the exact
     absolute path in `Implementation artifact: <absolute path>` from
     `step.prompt`: the `structure-outline.md` for every flow.
     A missing selection is a blocker; never infer selection
     from the presence of `plan.md`. Below, “plan” means the selected artifact.
   - Read `ticket.md` and the user-resolved design discussion for intended
     behavior. The design owns behavior and
     the outline owns executable decomposition. Ignore any unrelated stale `plan.md`.
     Use the selected artifact's automated verification commands.
   - Use the execution work root and exact implementation allowlist supplied by the
     CLI in `step.prompt` as your explicit scope. Run all source reads, edits, and commands there; the
     task directory may live elsewhere. Do not discover another repository or
     switch branches. Inspect `git status --short` and `git diff` for context,
     never as authority to expand the allowlist.

2. **Bound the pass to the chunk**:
   - Edit only files the chunk already changed and the CLI explicitly allowlists.
     An absent allowlist is a blocker, not permission to infer one from git status.
     Preserve pre-existing edits and index entries. Every edit must trace to a
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

4. **Apply the objective**: preserve the implemented behavior while minimizing
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
     to the review step's repair round or a new chunk.

6. **Stay in your lane**:
   - Do not stage, commit, or push. The CLI verifies the source boundary at completion.
   - Do not edit paths outside the allowlist or any task artifact (`ticket.md`,
     `structure-outline.md`, research, `evidence/`, design, or review documents).
   - Do not add dependencies.

## Output

Return a summary in this shape — `spok flow complete --summary` records it
permanently:

```
Resolved scope:
- <the exact allowlist paths you treated as in scope>
Fixes applied:
- <finding → edit, with file paths> (or "None — implementation already minimal.")
Candidates skipped:
- <candidate and why: outside the allowlist, would add structure, or broke a check and was reverted>
Changed paths:
- <path relative to the work root, each inside the allowlist> (or "None.")
Behavior preserved:
- <exact command> — <actual result and exact exit code>
Remaining concerns:
- <duplication needing a broader refactor, complexity that could not be reduced, or "None.">
```

Do not claim a check passed without naming the exact command that ran. If you
changed nothing, state that no checks were re-run because no code changed. A
no-op is success, not a failure to report.
