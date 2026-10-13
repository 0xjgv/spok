---
name: spok-implement-plan
description: Implement phases from the reviewed structure outline, selected by the CLI or supplied directly.
---

# Implement the Plan

Inside `spok-flow`, read the exact absolute path in
`Implementation artifact: <absolute path>` from `step.prompt`. This selects the
reviewed `structure-outline.md` for every flow.
A missing selection is a blocker; never choose an artifact because `plan.md`
exists. Outside the flow, accept an explicit reviewed outline path, or use
`<task-dir>/structure-outline.md` when given a task directory.

Read the selected outline fully; below, “plan” means this reviewed outline.
Read the resolved `design-discussion.md`. The design owns behavior and the outline
owns executable decomposition. Ignore any unrelated stale `plan.md`.
Implement the selected artifact's phases in order,
starting at the first unchecked item when resuming. Verify completed work when
evidence suggests it changed.

## Execution Boundary

Inside `spok-flow`, the CLI establishes the execution work root, branch, and
baseline before implementation. The dispatching `step.prompt` is authoritative:
use its work root for every source read, edit, and verification command. The task
directory may live in another repository. Do not discover a different repository,
create another worktree, or switch branches. Preserve all pre-existing edits and
index entries; stop and report an overlap that prevents keeping them separate.

Implement each phase directly in this agent.
Do not launch `spok-implementer-agent` or any other nested agent.
The outer flow step already selected the runner, model, and effort.
Outside the flow, establish the intended repository from the supplied plan and
repository context before editing, and use `spok-implementer-agent` in the
foreground when delegation is needed.

## Phase Workflow

1. Read the phase and relevant source and tests. Implement only its required work.
2. Run the automated checks named in the plan. Resolve failures before continuing.
3. Perform relevant UI or manual checks yourself when available. Record the action,
   observed result, and evidence. Human signoff is not a routine phase requirement.
4. Continue to the next phase after verification. Report decisions and consequential
   mismatches; use judgment to ask when input would help or resolve a blocker.
   Inside the flow, use the injected question-packet protocol and durable answers.
   Do not insert approval gates between phases.

Report a consequential mismatch in this shape:

```
Expected: <what the plan says>
Found: <what the code does, at path:line>
Why this matters: <the required behavior or check at risk>
```

Report only checks you actually executed. If the plan names a command that does not exist in this repository, say so and name the command — never substitute a different command silently, and never report the named command as passing. A command that exits 0 because the tool was downloaded on demand and found nothing to configure has verified nothing.

Do not stage, commit, or push. The flow's later commit step owns committing.
If an issue blocks implementation, return its evidence rather than marking the
phase complete. Missing required verification remains missing evidence.

## Output

Return:
- Completed phases and relevant decisions.
- Every changed path relative to the authoritative work root, including new and
  deleted files. After resume, return the full cumulative chunk list, not only
  paths edited in this dispatch. The outer flow passes these with
  `--changed-path <paths...>`; the CLI compares them with actual changes against
  its baseline and captures the implementation footprint at completion;
  this becomes the exact allowlist for subsequent mutation stages.
- For each check, the exact command you ran and its real output, plus its exact
  exit code. Name unrun checks and blockers without claiming success.
- UI/manual checks performed and their observed results; unresolved concerns.

In inner flow mode, finish successful completion with
`Work root: <absolute path>` matching the CLI-provided execution work root.
A question response instead ends with `NEEDS_INPUT: <absolute-question-packet-path>`;
these outcomes are mutually exclusive. Never append a work-root line after a
question marker or report a different work root.
