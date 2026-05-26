---
name: spok-validate-implementation
description: validate an implementation against a task plan and current code. use this when given a .humanlayer/tasks/*/*-plan.md path or when asked to verify implemented work before review or PR
---

# Validate Implementation

You are validating implemented work against an existing implementation plan and the current codebase state.

## Input

- `planPath`: Path to the plan document (e.g. `.humanlayer/tasks/TASKNAME/YYYY-MM-DD-plan.md`)
- Optionally, a task directory in `.humanlayer/tasks/TASKNAME`
- Optionally, an ExecPlan path for additional validation context
- Optionally, a ticket file containing feedback or review comments

## Initial Check

If the user does not provide a plan path or task directory, ask for it:

```
I'm ready to validate the implementation. Please provide the plan path or task directory in `.humanlayer/tasks/` so I can compare the implemented work against the plan and run the required checks.
```

Then wait for the user's input.

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read the plan document and any other provided paths
   - If a ticket like ENG-1234 or a task is mentioned, find the task directory: `ls .humanlayer/tasks/ | grep -i TEAMID-XXX`
   - If the user gave a task directory instead of a specific file, use `ls .humanlayer/tasks/TASKNAME` and read the most recent `YYYY-MM-DD-plan.md`
   - Read all relevant files in the task directory to build full context
   - If an ExecPlan path is provided or clearly referenced, read it fully as additional validation context

2. **If a ticket file is provided, read it for validation context**:
   - Look for comments mentioning you (linear-assistant, LinearLayer, claude)
   - Use those comments as validation context, not as proof that the work is correct

3. **Understand the current implementation state**:
   - Check the current git diff and git status
   - Read the source files and test files referenced by the plan
   - Read any files changed by the implementation that appear relevant to planned behavior
   - Identify the automated and manual success criteria promised by the plan

4. **If the user gives any input**:
   - DO NOT just accept the claim blindly
   - Read the specific files/directories they mention
   - Verify that code, tests, and commands support the claim
   - Only proceed once you've verified the facts yourself

5. **Spawn sub-agents for follow-up investigation** (if needed):

   **For deeper investigation:**
   - **codebase-locator**: Find additional files if needed
   - **codebase-analyzer**: Deep-dive on specific implementation paths
   - **codebase-pattern-finder**: Find existing repository patterns to compare against

   Do not run agents in the background - FOREGROUND AGENTS ONLY.

6. **Run validation checks**:
   - Execute the automated verification commands promised by the plan when they are available in the current environment
   - If the plan omits a command but names a concrete expected test or check, run the closest exact command that proves the behavior
   - Record command results, failures, skipped checks, and environment blockers
   - Treat a required automated check that cannot run or does not pass as a validation failure unless the plan explicitly marked it as manual-only

7. **Get an independent subagent go/no-go review**: (in parallel if other validation work remains)
   - Use a foreground subagent, preferably **qa** for validation/readiness reviews or **codebase-analyzer** for implementation-path reviews
   - Give the subagent a bounded prompt with:
     - the plan path
     - any ExecPlan path
     - the relevant task directory
     - a concise summary of the current diff or implementation state
     - the automated checks you ran and their results
     - the exact question: should this implementation receive a GO or NO-GO against the plan, and what blocking findings remain
   - Ask the subagent to return:
     - `GO` or `NO-GO`
     - blocking findings
     - missing or weak evidence
     - confidence level and key assumptions
   - If the subagent cannot run or returns an ungrounded answer, record that as missing independent review evidence and continue local validation conservatively

8. **Compare implementation against the plan**:
   - Check each implemented phase or success criterion against the actual code and test evidence
   - Synthesize your own findings with the subagent's go/no-go review
   - Treat the subagent as an independent review input, not as the source of truth
   - Record mismatches between the written plan and the current implementation state
   - If an ExecPlan is present, compare its `Progress`, acceptance language, and required outcomes against observed reality without editing the ExecPlan
   - Use a binary verdict:
     - `PASS`: all required implemented behavior is present and required automated checks passed
     - `FAIL`: any required behavior is missing, contradicted, unproven, blocked by failing or unrun required checks, or still waiting on required manual validation

## Output Document

1. **Read the validation template**

`Read({SKILLBASE}/references/validation_template.md)`

1. **Write the validation document** to `.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-validation.md`
   - First, find the task directory: `ls .humanlayer/tasks | grep -i "eng-XXXX"`
   - If the directory doesn't exist, create: `.humanlayer/tasks/ENG-XXXX-description/`
   - Format: `YYYY-MM-DD-validation.md` where YYYY-MM-DD is today's date
   - Directory naming:
     - With ticket: `.humanlayer/tasks/ENG-1478-parent-child-tracking/2025-01-08-validation.md`
     - Without ticket: `.humanlayer/tasks/feature-name/2025-01-08-validation.md`

2. **Read the final output template**

`Read({SKILLBASE}/references/validation_final_answer.md)`

1. Respond to the user with a summary following the template, including GitHub permalinks when available

## Validation Guidelines

- Missing evidence counts as failure for required work
- Required manual checks that have not been performed must be called out explicitly and keep the verdict at `FAIL`
- Do not mutate source files, task plans, or ExecPlans as part of validation; only the validation document should be written
- Be transparent about which subagent reviewed the implementation and validate its output before relying on it
- Prefer concrete evidence: file paths, line references, command results, failing tests, and observed gaps

## Document Precedence

When documents conflict, use this order:
**implementation state + executed checks > plan > structure outline > design discussion > research > ticket**

If the implementation does not match the plan, do not rewrite history. Record the mismatch and fail validation if the discrepancy affects required behavior or proof.

<guidance>
## Cloud Permalinks

When you write or edit documents in .humanlayer/tasks/, a cloud permalink is automatically provided in the hook response.

- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations
- Use this permalink in your final output for easy navigation
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`

## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````

## Validation Design

Required manual validation should not be treated as optional if the plan says it is required.
Automated verification is always better than manual validation - prefer commands and tests whenever the plan and codebase make that possible.

## Response

Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/validation_final_answer.md`
</guidance>
