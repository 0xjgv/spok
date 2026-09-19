---
name: spok-ci-commit
description: Commit Changes in CI with no user interaction
---

# Commit Changes

You have **no session history of the work**. Derive commit evidence from the
CLI-provided execution metadata, task artifacts, and git.

## Inputs

- `<work-root>` — the authoritative absolute execution repository in `step.prompt`.
  Run **every** git command with `-C <work-root>`. If absent, stop and report the
  missing execution metadata. Do not discover a repository or switch branches.
- The CLI-provided branch, baseline, pre-existing changes, and exact owned-path
  allowlist. These define the commit boundary; do not infer ownership from status.
- `<task-dir>` — the directory containing `plan.md` and `validation.md`.
  It is often a **different** repository from `<work-root>`.

## Process

If the dispatch prompt says the CLI already verified a completed chunk commit
while resuming, report the current HEAD SHA and work root without staging or
creating another commit. The remaining process applies to an uncommitted chunk.

1. **Derive the expected file list from the artifacts** as a cross-check:
   Read the plan and validation. Compare their intended changes with the CLI's
   exact owned-path allowlist; the allowlist is authoritative. A planned file
   that needed no change is not a mismatch or automatic failure.

2. **Verify the boundary**:
   Inspect status, working-tree diff, and staged diff in the supplied work root.
   Stage exactly the **intersection** of the owned-path allowlist and actual
   changed paths. Unrelated pre-existing edits or staged entries are allowed;
   preserve them. Never stage a path you did not modify as part of this chunk;
   other agents may be working in this repository concurrently.
   Never treat a gitignored path as committable: use
   `git -C <work-root> check-ignore` before staging expected paths.
   **Fail loudly instead of falling back to a directory scan.** If the owned change set is empty after verification, report a no-op with
   the existing HEAD SHA and do not create an empty commit. Stop on unexplained
   ownership overlap, branch mismatch, or changed baseline; do not widen the search to another directory.

3. **Commit only owned changes**:
   Use explicit paths, never `git add -A` or `git add .`. Preserve the original
   index and unrelated working-tree edits. When unrelated paths are staged, use
   a temporary index initialized from HEAD, stage owned paths there, and verify
   its staged path set equals the intended owned change set before committing.
   Pass that temporary index to every staging and commit command in that operation.
   Do not replace or reset the real index wholesale. After success, update only
   committed owned paths in the real index to the new HEAD so those changes do
   not appear reversed; leave unrelated index entries and file contents intact.
   Remove the temporary index when done. Never use stash or a broad reset to
   obtain a clean tree. If a hook changes the staged set, recheck the boundary
   before committing; unexpected paths must not enter the commit.
   Use a descriptive imperative commit message explaining the change. Execute
   the authorized commit without a routine confirmation gate. Do not push.

4. **Verify and report**:
   Check the commit's paths against the owned change set and confirm unrelated
   edits and index entries remain intact. Return the SHA from
   `git -C <work-root> rev-parse HEAD`, the same work root, committed paths,
   exact verification commands and exit codes, and any remaining owned changes.
