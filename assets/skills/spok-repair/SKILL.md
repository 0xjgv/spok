---
name: spok-repair
description: fix the confirmed findings recorded in a correctness review.md, re-run the checks the findings cite, and return a concise summary. Invoked by spok-review-correctness for each repair round.
argument-hint: <review-file> (absolute path to review.md inside the task directory)
version: 0.2.0
---

# Repair Correctness Findings

You are repairing an implementation whose correctness review found confirmed defects. `spok-review-correctness` launches you for one repair round. The argument is the absolute path to `review.md` — a `type: correctness-review` report with `verdict: FAIL`.

## Steps

1. **Read the review document FULLY**:
   - Use the Read tool WITHOUT limit/offset on the argument path.
   - Extract the confirmed findings — each with its `file:line`, trigger, impact, and fix direction. Skip findings marked `rejected`.

2. **Build context from the task directory**:
   - The task directory is the directory containing `review.md`. Read the structure outline named in your prompt (the `structure-outline.md` from `Implementation artifact: <absolute path>`), plus `ticket.md`, `evidence/causal-paths.md`, and the user-resolved `design-discussion.md` for intended behavior and success criteria. Do not choose an artifact by file existence or use a stale `plan.md` to override the selection. A missing outline path is a blocker; outside a flow, use `<task-dir>/structure-outline.md` when only the review path was supplied.
   - Read the source and test files the findings reference before changing anything.

3. **Fix exactly the confirmed findings**:
   - Surgical changes only: every edit must trace to a confirmed finding. Do not widen scope, refactor opportunistically, or address coverage gaps the review did not mark as defects.
   - Fix at the first wrong step the evidence note names, as the finding's fix direction says; a guard below it does not repair it.
   - Add regression coverage for each fixed finding where practical, in an allowlisted test file.
   - If a finding is wrong about the code, do not "fix" working code to match it — leave the code unchanged and say so in your summary; the next re-review judges it.
   - Stay inside the execution work root and the owned-path allowlist the CLI supplies in `step.prompt`, as relayed in your prompt with the baseline `HEAD`. Edit only allowlisted paths, and report the entire updated chunk path list. An absent allowlist is a blocker, not permission to infer one from `git status`.
   - If a confirmed finding needs work beyond that bound — an unowned path, another chunk, another repository, a dependency change — do not widen scope. Leave it unchanged and report it as a remaining blocker.

4. **Re-run the checks the findings cite**:
   - Run the exact failing commands or tests named by the findings, then the verification commands from your prompt, and confirm they pass.
   - If a finding names no command, run the closest check that proves the behavior.

5. **Leave the review artifact alone**:
   - Do NOT edit, rewrite, or delete `review.md` — `spok-review-correctness` re-reviews and rewrites it. Do not stage or create any commits.
   - Repair rounds are budgeted by `spok-review-correctness` (at most two); an exhausted budget leaves the review at `FAIL`. Do not edit `review.md` to change the verdict and do not retry beyond the dispatched round.

## Output

Return a summary in this shape — the review records it under its repair round:

```
Findings addressed:
- <confirmed finding → fix applied, with file paths> (or "<finding> — no change needed: <reason>")
Commands run:
- <exact command> — <actual result and exact exit code>
Changed paths:
- <path relative to the work root — the full cumulative chunk list, not only this round>
Remaining blockers:
- <finding left unfixed and why> (or "None.")
```

Do not claim a check passed without naming the exact command that ran.
