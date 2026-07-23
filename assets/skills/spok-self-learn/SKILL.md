---
name: spok-self-learn
description: Produce an advisory post-commit review of workflow friction, issues, weak evidence, and improvement opportunities for a completed Spok flow chunk.
license: MIT
metadata:
  author: spok
  version: "1.1"
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
6. Distil at most **3** candidate rules from those findings (see *Writing a rule*).
7. Read `<project-root>/spok/MEMORY.md` if it exists. Collect the already-promoted
   slugs and the current rule count.
8. Glob `spok/changes/*/.flow/*/self-learn.md` and
   `spok/changes/archive/*/.flow/*/self-learn.md`, excluding this run's task
   directory. Count slug occurrences in their `## Candidate Rules` sections and add
   this run's own candidates to the count.
9. A slug seen **twice or more** and not already in `MEMORY.md` is a `PROMOTE`.
   Everything else is a hold, reported with its count.
10. When `MEMORY.md` already holds 20 rules, name the weakest existing rule a
    `PROMOTE` would have to displace. Never propose growth past the cap.
11. Write the advisory report to `<task-dir>/self-learn.md`.

## Writing a rule

- One sentence, one line, imperative. If it needs two sentences it is not a rule yet.
- Names a file, command, or step. No concrete referent means it is friction, not a
  rule — leave it in `## Friction`.
- Repo-invariant, not chunk-specific. If it only applies to the work just shipped,
  it is a Follow-Up.
- Slugs stay stable across chunks: pick the name the same finding would get next time.
- Three candidates is a ceiling, not a quota. Most runs should emit zero or one.

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

## Candidate Rules

- slug: `<kebab-case-slug>`
  rule: <one imperative sentence, one line, ready to paste>
  evidence: <task-dir> @ <commit-sha>

## Promotion Candidates

- `<slug>` — seen <N>x (<chunk slugs>) — PROMOTE
  - `<slug>` — <the exact MEMORY.md line to paste>
- `<slug>` — seen 1x — hold
```

`## Candidate Rules` holds at most 3 entries. Omit the section entirely rather
than padding it.

## Guardrails

- Do not edit source code, tests, specs, tasks, config, or commits.
- Do not edit `spok/MEMORY.md`. Promotion is the human's call; this report only proposes it.
- Do not run mutating git commands.
- Do not block the shipped chunk. The output is advice for future work.
- Be concrete: cite files, step names, command outputs, and commit metadata.
- Avoid generic praise or generic process advice. If there is no finding, say so.
