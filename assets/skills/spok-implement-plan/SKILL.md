---
name: spok-implement-plan
description: Implement structure outline phases with one implementer subagent per phase, selected by the CLI or supplied directly.
argument-hint: <outline-or-task-dir> (absolute structure-outline.md path, or the task directory)
license: MIT
metadata:
  author: spok
  version: "1.1"
---

# Implement the Plan

You are the orchestrator. Each phase of the outline goes to its own implementer
subagent; you verify its work, track progress in the outline, and move on. Done
when every phase's Automated Verification commands exit 0 on your own rerun,
every phase is ✅ (a phase whose only open items are manual checks counts as
done, and you list those checks), and you return the output below.

Inside `spok-flow`, read the exact absolute path in
`Implementation artifact: <absolute path>` from `step.prompt`. This selects the
`structure-outline.md` for every flow.
A missing selection is a blocker; never choose an artifact because `plan.md`
exists. Outside the flow, accept an explicit outline path, or use
`<task-dir>/structure-outline.md` when given a task directory.

Read the selected outline fully; below, “plan” means this outline.
Read the resolved `design-discussion.md`. The design owns behavior and the outline
owns executable decomposition. Ignore any unrelated stale `plan.md`.
Implement the selected artifact's phases in order,
starting at the first unchecked item when resuming. Verify completed work when
evidence suggests it changed.

## Execution Boundary

Inside `spok-flow`, the CLI establishes the execution work root, branch, and
baseline before implementation. The dispatching `step.prompt` is authoritative:
use its work root for every source read, edit, and verification command, and its
baseline `HEAD` for every phase assignment. The task directory may live in another
repository. Do not discover a different repository, create another worktree, or
switch branches. Preserve all pre-existing edits and index entries; stop and
report an overlap that prevents keeping them separate.

Outside the flow, establish the intended repository from the supplied plan and
repository context before editing, and record its `HEAD` as the baseline.

## Nested Agents

Launch one `spok-implementer-agent` per phase through the current host's native
subagent mechanism. Nested agents are allowed here and preferred: they keep each
phase's context bounded. If `spok-implementer-agent` is unavailable, use the
host's general writable subagent with the same assignment.

- Pass the step's model on every agent call, except `spok-codebase-locator`,
  `spok-codebase-analyzer`, and `spok-codebase-pattern-finder`, which get
  `sonnet`.
- Run every agent and test in the foreground and wait for it. Never start
  background work or end your turn while one is still going: you are not resumed
  when background work finishes, so later phases never start.
- Launch phases one at a time, in order. Never run two implementer agents at once.

## Phase Workflow

For each phase not yet marked ✅:

1. **Assign the phase.** Give the implementer agent:
   - the absolute work root and the absolute outline path;
   - the exact phase identifier and the full phase text, copied from the outline;
   - the absolute paths the phase owns, from its Change Outline and Tests, plus
     any path an earlier phase in this run already changed that this phase must
     extend;
   - the baseline `HEAD`;
   - every Automated Verification command, in order, with its working directory.
   Tell it the design discussion path for context, and that it must not commit.
2. **Read its envelope.** On `blocked` or `needs_root`, resolve the issue from
   the code when the code answers it, then relaunch the phase. Otherwise stop and
   return the blocker with its evidence.
3. **Rerun the automated checks yourself.** Do not trust the agent's report.
   Rerun the phase's Automated Verification commands from the work root, plus any
   build, test, or lint check the phase plainly needs. Record each exact command
   and exit code. On failure, relaunch the phase with the failing output.
4. **Perform relevant UI or manual checks yourself** when available. Record the
   action, observed result, and evidence. Human signoff is not a routine phase
   requirement; list manual checks you could not perform.
5. **Mark progress in the outline.** Tick each passing Automated Verification
   checkbox `- [ ]` → `- [x]`, tick the phase's `- [ ] Phase N:` entry under
   `## Implementation Overview`, and change the heading `## Phase N: Title` to
   `## ✅ Phase N: Title`. Edit only these markers.
6. **Continue to the next phase** at once. Run all phases consecutively: no
   approval pauses between phases, no per-phase or final commits.

When resuming, trust ✅ headings and `- [x]` checkboxes as done unless the code
or `git status --short` says otherwise, and start at the first phase without ✅.

Report a consequential mismatch in this shape:

```
Expected: <what the plan says>
Found: <what the code does, at path:line>
Why this matters: <the required behavior or check at risk>
```

Resolve mismatches from the code when it answers them. When a mismatch needs
user intent, when running under `spok flow`, raise it through the flow's
question packet; otherwise use AskUserQuestion.

Report only checks you actually executed. If the plan names a command that does not exist in this repository, say so and name the command — never substitute a different command silently, and never report the named command as passing. A command that exits 0 because the tool was downloaded on demand and found nothing to configure has verified nothing.

Do not stage, commit, or push. The flow's later commit step owns committing.
If an issue blocks implementation, return its evidence rather than marking the
phase complete. Missing required verification remains missing evidence.

## Output

Return:
- Completed phases and relevant decisions.
- Every changed path relative to the authoritative work root, including new and
  deleted files. After resume, return the full cumulative chunk list, not only
  paths edited in this dispatch. Do not list the outline's progress-marker edits
  when the task directory lies outside the work root. The outer flow passes these with
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
