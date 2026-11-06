---
name: spok-review-correctness
description: Review the chunk's full change set for correctness with a fresh read-only reviewer, confirm each finding, repair confirmed defects through spok-repair for at most two rounds, and write review.md with a PASS or FAIL verdict and every verification command's exit code. Invoked by spok-flow between simplify and commit.
argument-hint: <task-dir> (absolute task directory; the CLI supplies the work root, baseline, and allowlist)
license: MIT
metadata:
  author: spok
  version: "1.0"
---
# Correctness Review

You orchestrate. A fresh reviewer finds defects; you confirm them from the code;
a repair agent fixes the confirmed ones; a fresh reviewer checks again. Done when
`<task-dir>/review.md` exists with its verdict and your reply returns its
absolute path.

## Inputs

- The argument is the absolute path to the task directory. It already exists.
- From `step.prompt`: the execution work root, the baseline `HEAD`, and the
  exact implementation allowlist. Run every command from the work root. An
  absent work root, baseline, or allowlist is a blocker; never infer one from
  `git status`.
- Task artifacts, by absolute path: `<task-dir>/ticket.md`,
  `<task-dir>/evidence/causal-paths.md`, `<task-dir>/design-discussion.md`, and
  the `structure-outline.md` named in `Implementation artifact: <absolute path>`.
- Verification commands: every Automated Verification command in the outline,
  with its working directory.

## Nested Agents

Launch every reviewer and repair agent through the current host's native
subagent mechanism, each fresh, with no context beyond its prompt.

- Pass the step's model on every agent call, except `spok-codebase-locator`,
  `spok-codebase-analyzer`, and `spok-codebase-pattern-finder`, which get
  `sonnet`.
- Run every agent and test in the foreground and wait for it. Never start
  background work or end your turn while one is still going: you are not resumed
  when background work finishes, so later work never starts.

## Steps

1. **Launch a fresh reviewer.** It runs no skill; this contract, with the
   absolute paths, work root, baseline, and allowlist filled in, is its whole
   prompt:

   > Review the task's implementation for correctness against the structure outline. You are read-only: do not edit, stage, commit, or push, and do not update task artifacts.
   > Inputs: the ticket, `evidence/causal-paths.md`, design discussion, and structure outline at `<absolute paths>`; the work root at `<absolute work root>`; baseline `HEAD` `<sha>`; the implementation allowlist `<paths>`. Review the full task change set (staged, unstaged, and untracked files in the allowlist), not a committed-only diff.
   > Read the changed code and its callers and tests, not the implementation summaries. Check intended behavior, missing requirements, concrete failure paths, security boundaries, and regressions. Plan conformance alone is not correctness. Ignore style.
   > Check that the fix sits at the first wrong step the evidence note names: show that step's input and output. A fix below it, where the symptom shows, is a finding. When the note says `N/A: no defect`, skip this check.
   > Run focused checks where you can; list any you could not run as exact commands.
   > Return high-confidence findings only, each with `file:line`, trigger, impact, and fix direction; then coverage gaps and checks run with exit codes. No findings is a valid result.

2. **Confirm each finding from the code yourself.** Read the cited lines and
   the path that triggers them. A finding you cannot confirm is recorded as
   rejected, with the reason; it does not count against the verdict.

3. **Repair confirmed defects.** Launch a fresh repair agent that calls the
   `spok-repair` skill with the absolute path of a draft `<task-dir>/review.md`
   holding the confirmed findings (write it first, with `verdict: FAIL`). Give
   it the work root, the baseline `HEAD`, the exact allowlist as its owned
   paths, and the verification commands. It adds regression coverage where
   practical, keeps every edit inside the allowlist, and does not stage or
   commit. Check that every path it changed is inside the allowlist; a path
   outside it is a confirmed defect of its own.

4. **Re-review.** Launch a fresh reviewer with the same contract on the updated
   state, then confirm its findings as in step 2.

5. **Cap repairs at two rounds.** After the second repair round's re-review, stop.
   Confirmed defects that remain stay in the report with their evidence.

6. **Run the verification commands yourself** from the work root after the
   last change: every outline Automated Verification command, plus each focused
   check a reviewer or repair agent ran. Record each exact command and its exact
   exit code. Never invent an exit code; record a command that cannot run as
   `not run` with the reason.

Never stage, commit, or push. Do not edit source yourself; only the repair agent
edits, and only inside the allowlist. Do not edit task artifacts other than
`review.md`.

## Output

Write `<task-dir>/review.md`. It starts with this exact frontmatter, using
`verdict: PASS` when no confirmed defect remains and every verification command
exited 0, and `verdict: FAIL` otherwise:

```markdown
---
type: correctness-review
verdict: PASS
---

# Correctness Review

## Findings
### <finding title>
- Location: <file:line>
- Trigger: <input or path that reaches it>
- Impact: <what goes wrong>
- Fix direction: <where and how>
- Status: <confirmed and repaired in round N | confirmed and unresolved | rejected: reason>

(or "None.")

## Repair Rounds
### Round 1
- Findings addressed: <titles>
- Changed paths: <paths relative to the work root>
- Re-review result: <new or remaining findings, or "None.">

(or "None.")

## Coverage Gaps
- <gap the reviewers named, or "None.">

## Verification
- `<exact command>` (cwd: <directory>) — exit <code>
```

List every verification command in `## Verification`, one per line, in the
form above; the commit step reruns exactly these commands. After writing, run
`ls -la <task-dir>/review.md`. If it is missing or empty, write it again.

Return the absolute path of `<task-dir>/review.md`, the verdict, the confirmed
findings and their outcome, every path the repair rounds changed relative to the
work root, and each verification command with its exit code.
