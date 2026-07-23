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
   - The task directory is the directory containing `validation.md`. Read `plan.md` and `ticket.md` there for the intended behavior and success criteria.
   - Read the source and test files the findings reference before changing anything.

3. **Fix exactly the blocking findings**:
   - Surgical changes only: every edit must trace to a blocking finding. Do not widen scope, refactor opportunistically, or address non-blocking notes.
   - If a finding is wrong about the code, do not "fix" working code to match it — leave the code unchanged and say so in your summary; the next validation run re-judges it.

4. **Re-run the checks the findings cite**:
   - Run the exact failing commands or tests named by the findings and confirm they now pass.
   - If a finding names no command, run the closest check that proves the behavior.

5. **Leave the validation artifact alone**:
   - Do NOT edit, rewrite, or delete `validation.md` — the next `validate` step re-runs validation and rewrites it. Do not create any commits.

## Output

Return a concise summary of what you did: each blocking finding, the fix applied (or the reason no change was needed), and the exact commands you re-ran with their results. Do not claim a check passed without naming the command that ran.
