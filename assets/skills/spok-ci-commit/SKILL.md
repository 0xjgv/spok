---
name: spok-ci-commit
description: Commit Changes in CI with no user interaction
---

# Commit Changes

You are tasked with creating git commits for a completed unit of work.

You have **no session history of the work**. A separate subagent made the changes and its
context is gone. Everything you commit must be derived from artifacts on disk and from git
itself — never from memory, never from a scan of whatever directory you happen to start in.

## Inputs

- `<work-root>` — the absolute path of the repository whose working tree holds the changes.
  The dispatching prompt states it. Run **every** git command with `-C <work-root>`.
  If no work root was given, say so in your report before doing anything else, then resolve
  it from the task directory with `git -C <task-dir> rev-parse --show-toplevel` and state
  the path you settled on.
- `<task-dir>` — the planning directory holding `plan.md`, `validation.md`, and the other
  flow artifacts. It is often a **different** repository from `<work-root>`.

## Process:

1. **Derive the expected file list from the artifacts:**
   - Read `plan.md` and `validation.md` (and `research.md` when present) in the task dir and
     list every path they say this chunk creates or modifies.
   - This artifact-derived list is the authority on what belongs in the commit.

2. **Confirm it against the repository:**
   - Run `git -C <work-root> status --porcelain` and `git -C <work-root> diff` to see what
     actually changed.
   - Stage exactly the **intersection** of the artifact-derived list and the changed paths.
   - **Fail loudly instead of falling back to a directory scan.** If the intersection is
     empty, if the artifacts name paths that are unchanged, or if the repository carries
     changed paths the artifacts never mention, stop and report the mismatch — listing both
     sets. Do not commit, do not widen the search to another directory, and do not commit
     unexplained changes on the assumption that they must be yours.

3. **Plan your commit(s):**
   - Identify which files belong together
   - Draft clear, descriptive commit messages
   - Use imperative mood in commit messages
   - Focus on why the changes were made, not just what

4. **Execute upon confirmation:**
   - Use `git -C <work-root> add` with specific files (never use `-A` or `.`)
   - Never stage a path you did not modify — other agents may be working in this repository concurrently, and their in-progress edits are not yours to commit. The artifact-derived list is how you know which paths those are.
   - Never treat a gitignored path as committable — run `git -C <work-root> check-ignore` on a path before listing it as an expected file, and drop the ones that are ignored
   - Never commit dummy files, test scripts, or other files which you created or which appear to have been created but which were not part of your changes or directly caused by them (e.g. generated code)
   - Create commits with your planned messages until all of your changes are committed with `git -C <work-root> commit -m`

5. **Report the commit:**
   - Return the SHA from `git -C <work-root> rev-parse HEAD` together with the work root it
     came from. The caller verifies the SHA against that repository, so a SHA from anywhere
     else will be rejected.

## Remember:
- Your evidence is the plan, the validation artifact, and `git -C <work-root> status` — never recollection
- Group related changes together
- Keep commits focused and atomic when possible
- Reporting a mismatch is a successful outcome; a wrong-repository commit is not
- **IMPORTANT**: - never stop and ask for feedback from the user.
