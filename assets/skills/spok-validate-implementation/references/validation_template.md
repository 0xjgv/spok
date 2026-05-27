---
task: eng-xxxx-description
type: validation
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
plan: [<task-dir>/plan.md]
exec_plan: [path if provided, otherwise "none"]
verdict: PASS|FAIL
---

# [Feature/Task Name] Validation

## Overview

[Brief description of what was validated and the overall result]

## Scope and Inputs

- Plan: `[path]`
- ExecPlan: `[path or "none"]`
- Validation date: `[today's date]`
- Working tree state: `[clean/dirty summary]`

## Validation Verdict

**Verdict**: `PASS` or `FAIL`

[1-2 paragraphs explaining the decision]

## Executed Checks

- `[command]` - `[pass/fail/skipped]` - [brief note]
- `[command]` - `[pass/fail/skipped]` - [brief note]

## Plan Coverage

### Covered and Verified

- [implemented behavior or phase with supporting evidence]
- [implemented behavior or phase with supporting evidence]

### Missing, Mismatched, or Unproven

- [gap tied to plan section, file, test, or command]
- [gap tied to plan section, file, test, or command]

## Blocking Findings

- [blocking issue, or `none`]

## Manual Validation Remaining

- [manual step still required, or `none`]

## Recommendation

[If PASS: ready for PR/review with any caveats. If FAIL: what must be addressed before PR/review.]
