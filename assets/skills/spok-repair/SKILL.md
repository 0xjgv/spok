---
name: spok-repair
description: fix the blocking findings recorded in a failing validation.md, re-run the checks the findings cite, and return a concise summary. Invoked by spok-flow after the validate step records a FAIL verdict.
argument-hint: <validation-file> (absolute path to the failing validation.md inside the task directory)
version: 0.1.0
---

# Repair Failing Validation

You are repairing an implementation that failed the flow's `validate` step. The argument is the absolute path to `validation.md` — the validation report whose verdict is `FAIL`.

## Steps

1. **Read the validation document FULLY**:
   - Use the Read tool WITHOUT limit/offset on the argument path.
   - Extract the blocking findings — the concrete failures that produced the `FAIL` verdict, including any file paths, line references, failing commands, and expected behavior they cite.

2. **Build context from the task directory**:
   - The task directory is the directory containing `validation.md`. Read the exact `Implementation artifact: <absolute path>` supplied in `step.prompt` (the reviewed `structure-outline.md`), plus `ticket.md`, the resolved design discussion, and passing design review for intended behavior and success criteria. Missing review evidence is a blocker. Do not choose an artifact by file existence or use a stale `plan.md` to override the selection. Missing artifact metadata inside a flow is a blocker; outside a flow, use the explicitly supplied reviewed outline, or `<task-dir>/structure-outline.md` when only the validation path was supplied.
   - Read the source and test files the findings reference before changing anything.

3. **Fix exactly the blocking findings**:
   - Surgical changes only: every edit must trace to a blocking finding. Do not widen scope, refactor opportunistically, or address non-blocking notes.
   - If a finding is wrong about the code, do not "fix" working code to match it — leave the code unchanged and say so in your summary; the next validation run re-judges it.
   - Stay inside the execution work root and the owned-path allowlist the CLI supplies in `step.prompt`. Edit the allowlisted paths plus only the paths a recorded blocking finding demonstrably requires, and report the entire updated chunk path list. An absent allowlist is a blocker, not permission to infer one from `git status`.
   - If a blocking finding needs work beyond that bound — another chunk, another repository, a dependency change — do not widen scope. Leave it unchanged and report it as a remaining blocker.

4. **Re-run the checks the findings cite**:
   - Run the exact failing commands or tests named by the findings and confirm they now pass.
   - If a finding names no command, run the closest check that proves the behavior.

5. **Leave the validation artifact alone**:
   - Do NOT edit, rewrite, or delete `validation.md` — the next `validate` step re-runs validation and rewrites it. Do not create any commits.
   - Repair attempts are budgeted by the CLI; an exhausted budget blocks the flow. Do not edit `validation.md` to unblock it and do not retry beyond the dispatched attempt.

## Output

Return a summary in this shape — `spok flow complete --summary` records it permanently:

```
Findings addressed:
- <blocking finding → fix applied, with file paths> (or "<finding> — no change needed: <reason>")
Commands run:
- <exact command> — <actual result and exact exit code>
Changed paths:
- <path relative to the work root — the full cumulative chunk list, not only this dispatch>
Remaining blockers:
- <finding left unfixed and why> (or "None.")
```

Do not claim a check passed without naming the exact command that ran.
