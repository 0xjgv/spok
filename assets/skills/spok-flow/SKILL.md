---
name: spok-flow
description: end-to-end problem validation → research → design → plan → implement → review → commit workflow for a single chunk, with native or hybrid model routing and an optional post-commit self-learn gate. Driven by spok-apply.
argument-hint: [hybrid] <task-dir> (absolute path to a pre-staged chunk directory containing ticket.md)
version: 0.9.0
---
# Flow Instructions

## 0. Receive Pre-Staged Task Directory

`spok-apply` has already created the task directory and written `ticket.md` for the chunk to execute. The argument to this skill is the **absolute path** to that directory (e.g. `spok/changes/<change-slug>/.flow/<chunk-slug>/`). A leading `hybrid` token selects the built-in Claude + Codex execution profile; remove that token before resolving the task directory.

> Verify the directory exists and contains `ticket.md` using the **Read** tool. Do NOT recreate the directory or overwrite `ticket.md`.

If `ticket.md` is missing, halt and report back — `spok-apply` is responsible for staging it.

## 1. Deterministic Control Loop

The `spok` CLI owns the inner flow sequence and resume state. Do not choose, skip, reorder, or rename steps yourself.

For a hybrid invocation, prefix every `spok flow status`, `spok flow next`, and
`spok flow complete` command with `SPOK_FLOW_PROFILE=hybrid`. For a default
invocation, run the commands without that environment variable. An existing
workflow state owns its persisted profile; if the requested profile conflicts,
surface the CLI blocker exactly.

Run:

```bash
spok flow status "<task-dir>" --json
```

Hybrid equivalent:

```bash
SPOK_FLOW_PROFILE=hybrid spok flow status "<task-dir>" --json
```

If it returns `state: "blocked"`, halt and report the `reason` exactly, applying the design-review clause in step 6 when it matches.

Then repeat this loop until the CLI returns `state: "complete"`:

1. Run:

   ```bash
   spok flow next "<task-dir>" --json
   ```

   For hybrid execution, use:

   ```bash
   SPOK_FLOW_PROFILE=hybrid spok flow next "<task-dir>" --json
   ```

2. If `next` returns `state: "blocked"`, halt and report the `reason` exactly, applying the design-review clause in step 6 when it matches. If it returns `state: "complete"`, return success to `spok-apply`.

3. Read the returned `step` object:
   - `id` is the workflow step id.
   - `skill` is the exact skill to invoke.
   - `runner` is the exact tool that must execute the step: `claude`, `codex`, `omp`, or `current`.
   - `model` is the exact model to pass to that runner.
   - `effort` is present when the step carries a reasoning-effort hint; relay it to the selected runner when present.
   - `argument` is the exact argument to pass to that skill.
   - `expectedOutput` is present for file-producing steps.
   - `prompt` is the **complete subagent prompt**, composed by the CLI. It already
     carries the skill invocation, the return contract, any step-specific clause,
     and the repository rules from `spok/MEMORY.md`. Do not rewrite, summarize, or
     add to it.

   If the response carries `memoryWarning` or `workRootWarning`, surface it to the user once and continue.

4. Dispatch the step through `step.runner`. The only valid runner values are
   `claude`, `codex`, `omp`, or `current`. If `step.runner` is anything else,
   report the malformed route and halt before dispatch. Do not detect or infer
   host identity from the environment; an explicit runner always executes
   through its named CLI.

   Validate required fields first: `claude`, `codex`, and `omp` require a
   non-empty `step.model`, and `omp` additionally requires a non-empty
   `step.effort`. If a required field is missing, report the malformed route
   and halt before dispatch. A `current` route carries no model or effort;
   ignore hand-authored `model` or `effort` values on it rather than inventing
   flags.

   - When `step.runner` is `current`, delegate in the foreground
     through the current host's native subagent mechanism to the
     host-owned `general-purpose` agent. Pass `<step.prompt>` **verbatim** as the prompt.
     Pass no model and no effort.
   - When `step.runner` is `claude`, first verify `claude` is on `PATH`, then
     run `claude -p` sequentially in the foreground. Use
     `--no-session-persistence`, `--model <step.model>`,
     `--permission-mode auto`, text output, and, when `step.effort` is present,
     `--effort <step.effort>`. Pass `<step.prompt>` **verbatim** on stdin; do
     not interpolate it into a shell command.
   - When `step.runner` is `codex`, first verify `codex` is on `PATH`, then run
     `codex exec` sequentially in the foreground. Use `--ephemeral`,
     `--dangerously-bypass-hook-trust`, `--cd <project-root>`,
     `--model <step.model>`, `--sandbox workspace-write`, and, when
     `step.effort` is present, `-c model_reasoning_effort="<step.effort>"`.
     Pass `<step.prompt>` **verbatim** on stdin with `-`; do not interpolate it
     into a shell command.
   - When `step.runner` is `omp`, first verify `omp` is on `PATH`. Then prove
     `<project-root>` is a linked Git worktree again, even though routing
     already checked at selection time: run
     `git -C "<project-root>" rev-parse --path-format=absolute --git-dir --git-common-dir`
     and require both printed absolute paths to resolve and differ. If the
     command fails or the two paths are equal, report the missing isolation and
     halt before sending the prompt. When the proof holds, run sequentially in
     the foreground:

     ```bash
     omp -p --no-session --cwd <project-root> --model <step.model> --thinking <step.effort> --auto-approve
     ```

     Pass `<step.prompt>` **verbatim** on stdin through the process API; do not
     interpolate it into a shell command.

   Resolve `<project-root>` with `git -C "<task-dir>" rev-parse --show-toplevel`.
   Run both Git commands with `GIT_DIR`, `GIT_COMMON_DIR`, and `GIT_WORK_TREE`
   removed from the child environment through the process API.
   Use `--dangerously-bypass-hook-trust` to run enabled hooks without an
   interactive trust prompt; it does not enable disabled hooks or relax the
   sandbox. Do not use `--dangerously-bypass-approvals-and-sandbox`. If the
   executable is missing, authentication fails, the isolation re-check fails,
   or the child exits nonzero, report the error and halt.
   Do not call `spok flow complete`; leaving the current step ready makes the
   run safely resumable after the tool is fixed.
   A failed dispatch never changes the harness, model, or effort,
   never sends the prompt through another runner, and never completes the ready
   step; the persisted ready route remains unchanged.

   Run every path **sequentially in the foreground** because each step depends
   on the previous step's validated artifact or recorded result. Do not invoke
   the step skill inline: process isolation keeps each step's context bounded.

5. Record completion with the CLI.

   A `--summary` is recorded permanently in `workflow-state.json`. Do not relay a verification claim that cannot be attributed to a command that ran during the step. If the subagent reports "lint clean" or "tests pass" without naming the command it ran, drop the claim from the summary rather than passing it through — the CLI checks only that the summary is non-empty, so you are the last check on it.
   - File-producing steps (the CLI verifies `expectedOutput` exists and is non-empty):

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --json
     ```

     Prefix this command with `SPOK_FLOW_PROFILE=hybrid` for a hybrid run, as
     described above.

   - `validate` additionally has its recorded verdict read from `validation.md` by the CLI: `PASS` completes the step. A `FAIL` with repair attempts remaining is a *successful* completion that routes to a `repair` step and then back to `validate` — the CLI may return `validate` more than once; complete every occurrence with the same bare `--step validate`. When repair attempts are exhausted and the verdict is still `FAIL`, `complete` (and subsequent `next`/`status`) return `state: "blocked"` with an exhausted-repair reason: report it exactly as returned — do not retry the step and do not edit `validation.md` to unblock it. An unreadable verdict blocks as before.

   - `implement`, `simplify`, and `repair` (dispatched like any other step when the CLI returns it):

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --summary "<summary>" --json
     ```

     The `implement` prompt requires the subagent to end its reply with a
     `Work root: <absolute path>` line naming the repository it edited. Pass that
     path through so the commit step is told where the changes live:

     ```bash
     spok flow complete "<task-dir>" --step "implement" --summary "<summary>" --work-root "<absolute-path>" --json
     ```

     Pass `--work-root` on `simplify` or `repair` too when that subagent reports a
     different repository. If the subagent reported no work root, omit the flag —
     the CLI degrades to unsteered commit discovery and warns. Never invent the
     path. A path that is relative or does not exist blocks the completion.

   - `commit`:

     ```bash
     spok flow complete "<task-dir>" --step "commit" --commit "<commit-sha>" --summary "<summary>" --json
     ```

     When a work root was recorded, the CLI resolves the SHA in that repository
     and blocks when it is not a commit reachable from `HEAD` there. Report such
     a block exactly; do not retry with a different SHA.

   - `self-learn` is an optional file-producing advisory gate returned only when
     project config enables `flow.self_learn: true`. Complete it like any other
     file-producing step. Its findings do not fail or amend the commit.

6. If `complete` returns `state: "blocked"`, halt and report the `reason` exactly. When the `reason` starts with `Step design-review recorded a FAIL verdict`, read `<task-dir>/design-review.md` and present its `## Human Decisions Required` section verbatim alongside the reason, then halt — do not retry the step and do not edit `design-review.md` to unblock it. When the `reason` starts with `Step design-review has no readable verdict`, read `<task-dir>/design-review.md` if it exists and present its `## Human Decisions Required` section verbatim alongside the reason if that section is present, then halt and report as a generic blocked state.

Do not restate or assume the step order — `spok flow next` is the only source of truth.
Do not derive or override runner or model routing inside this skill — `spok flow next --json` is the source of truth, including `step.runner`, `step.model`, and `step.effort`.
In plain terms: spok flow next --json is the source of truth for model routing.
Step-specific instructions — including the `implement` no-commit rule — are composed
into `step.prompt` by the CLI. Do not restate them.

<guidance>
## Important guidelines

- Raise questions or concerns about objectives, design, or plan to the user at any time using the **AskUserQuestion** tool.
- Run step subagents **sequentially in the foreground** because each step depends on the previous step's validated artifact or recorded result.
- Let `spok flow next` choose the next step. Let `spok flow complete` validate step completion.
- Use a **TaskList** to track the steps and their status.

</guidance>
