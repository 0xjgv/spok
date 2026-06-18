---
name: spok-validate-problem
description: optional first step when fixing, optimizing, or improving existing behavior - reproduce the bug or measure the baseline and capture empirical evidence before codebase research; skips as N/A for brand-new work with no existing behavior to validate.
---

# Validate Problem

You are validating a flow ticket the way a senior engineer starts work: before researching the codebase, gather hard empirical evidence that the reported problem is real.

The ticket's claim is propagated through the downstream flow, but research questions only document current state and research must not do root cause analysis. This stage tests the claim against reality.

## When This Applies

Run this check when the task is to fix, optimize, or improve existing behavior and there is a falsifiable current-state claim to prove or a measurable baseline to capture.

Skip it by writing verdict `N/A` when there is no falsifiable existing-behavior claim: a brand-new feature, a greenfield build, or a chore that adds behavior without changing current behavior. Decide by the claim, not the ticket label.

## Boundary

Your only job is to prove or disprove the reported problem.

- Reproduce the bug, measure the performance claim, or confirm the issue exists.
- Capture raw evidence: exact commands, output, timings, logs, screenshots, versions, and commit SHA.
- Do not map the codebase. That belongs to `spok-create-research-questions` and `spok-create-research`.
- Do not perform root cause analysis.
- Do not propose or hint at a solution.
- Do not edit source or commit tests.
- Use black-box signals: the ticket, running app/API/UI, logs, and documented commands.

Running a test or hitting an endpoint is allowed. The boundary is behavioral evidence versus structural documentation.

## Steps

1. Read the ticket fully. The skill argument is the absolute path to `<task-dir>/ticket.md`.

2. Classify the task type:
   - `bug`
   - `regression`
   - `performance`
   - `feature-greenfield`
   - `chore`

3. If there is no observable prior behavior to reproduce, write `<task-dir>/problem-validation.md` with verdict `N/A`, `Flow Decision` set to `proceed`, return its absolute path, and stop.

4. Derive the falsifiable claim and the narrowest empirical check:
   - Bug or regression: exact repro steps plus a failing command, test, UI path, log query, or API call.
   - Performance: a measured baseline with the number, method, commit, and environment.

5. Run the check and capture evidence verbatim. Do not diagnose and do not fix.

6. Assign one verdict:
   - `CONFIRMED`: the claim reproduced and evidence is attached.
   - `NOT-REPRODUCIBLE`: the exact claim was tested in a matching environment and did not occur.
   - `INCONCLUSIVE`: the claim could not be tested because data, credentials, environment, or stable evidence was missing.
   - `N/A`: there is no falsifiable existing-behavior claim.

7. Persist, then gate:
   - Write `<task-dir>/problem-validation.md` first.
   - Set `Flow Decision` to `proceed` for `CONFIRMED` or `N/A`.
   - For `NOT-REPRODUCIBLE` or `INCONCLUSIVE`, write the artifact with `Flow Decision` set to `pending user decision`, then ask the user whether to proceed with reduced confidence, provide missing repro data, or drop the task. Update `Flow Decision` with the answer. `spok-flow` only advances when this section starts with `proceed`.

## Output Format

1. Read the artifact template:

`Read({SKILLBASE}/references/problem_validation_template.md)`

2. Write the artifact to `<task-dir>/problem-validation.md`.
   - Derive `<task-dir>` from the parent directory of the ticket path argument.
   - The directory already exists. Do not create or search for another task directory.
   - Use the bare filename `problem-validation.md`.

3. Read the final output template:

`Read({SKILLBASE}/references/problem_validation_final_answer.md)`

4. Respond with a summary following that template and return the absolute path of `<task-dir>/problem-validation.md`.

For performance tasks, the measured baseline is the "before" that `spok-validate-implementation` can compare against later. State it explicitly. For non-performance bugs, the durable evidence is the failing repro.
