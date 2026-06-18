---
name: spok-self-learn
description: Produce an advisory post-commit review of workflow friction, issues, weak evidence, and improvement opportunities for a completed Spok flow chunk.
license: MIT
metadata:
  author: spok
  version: "1.0"
---
# Self-Learn Gate

You are running after the `commit` step in `spok-flow`. This gate is advisory.
It must not fail, amend, or rewrite the commit.

## Input

The argument is the absolute path to a task directory:

`<task-dir>`

The directory already exists and contains `ticket.md`, `workflow-state.json`,
and the artifacts produced by earlier flow steps.

## Steps

1. Read `<task-dir>/ticket.md` and every non-empty Markdown artifact in the task directory.
2. Read `<task-dir>/workflow-state.json` to understand step order, summaries, and the commit SHA.
3. Run read-only git commands from the current repository:
   - `git status --short`
   - `git show --stat --oneline --decorate --no-renames <commit-sha>` when a commit SHA is available
4. Use visible parent-thread context if the host provides it, but do not require or persist a raw transcript.
5. Identify:
   - workflow friction
   - issues or confusion during the session
   - weak, missing, or late evidence
   - instructions that should be updated, removed, or added
   - follow-up work candidates
6. Write the advisory report to `<task-dir>/self-learn.md`.

## Output

Write a Markdown file at `<task-dir>/self-learn.md` with this shape:

```markdown
# Self-Learn

## Verdict

advisory

## Evidence Used

- ticket: <path>
- workflow state: <path>
- commit: <sha or unavailable>
- artifacts reviewed: <count/list>
- visible thread context: <used/not available>

## Friction

- <specific friction, or "None observed.">

## Issues

- <specific workflow issue, or "None observed.">

## Weak Evidence

- <missing or weak proof, or "None observed.">

## Suggested Updates

- Add: <instruction/process/documentation update, or "None.">
- Remove: <outdated or harmful guidance, or "None.">
- Change: <adjustment, or "None.">

## Follow-Ups

- <follow-up candidate, or "None.">
```

## Guardrails

- Do not edit source code, tests, specs, tasks, config, or commits.
- Do not run mutating git commands.
- Do not block the shipped chunk. The output is advice for future work.
- Be concrete: cite files, step names, command outputs, and commit metadata.
- Avoid generic praise or generic process advice. If there is no finding, say so.
