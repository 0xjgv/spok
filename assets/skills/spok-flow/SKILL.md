---
name: spok-flow
description: end-to-end problem validation → research → design → plan → implement → review → commit workflow for a single chunk, with an optional post-commit self-learn gate. Driven by spok-apply.
argument-hint: <task-dir> (absolute path to a pre-staged chunk directory containing ticket.md)
version: 0.7.0
---
# Flow Instructions

## 0. Receive Pre-Staged Task Directory

`spok-apply` has already created the task directory and written `ticket.md` for the chunk to execute. The argument to this skill is the **absolute path** to that directory (e.g. `spok/changes/<change-slug>/.flow/<chunk-slug>/`).

> Verify the directory exists and contains `ticket.md` using the **Read** tool. Do NOT recreate the directory or overwrite `ticket.md`.

If `ticket.md` is missing, halt and report back — `spok-apply` is responsible for staging it.

## 1. Deterministic Control Loop

The `spok` CLI owns the inner flow sequence and resume state. Do not choose, skip, reorder, or rename steps yourself.

Run:

```bash
spok flow status "<task-dir>" --json
```

If it returns `state: "blocked"`, halt and report the `reason` exactly.

Then repeat this loop until the CLI returns `state: "complete"`:

1. Run:

   ```bash
   spok flow next "<task-dir>" --json
   ```

2. If `next` returns `state: "blocked"`, halt and report the `reason` exactly. If it returns `state: "complete"`, return success to `spok-apply`.

3. Read the returned `step` object:
   - `id` is the workflow step id.
   - `skill` is the exact skill to invoke.
   - `model` is the exact model to pass to the Agent tool.
   - `effort` is present when the step carries a reasoning-effort hint; relay it to the Agent tool when present.
   - `argument` is the exact argument to pass to that skill.
   - `expectedOutput` is present for file-producing steps.
   - `prompt` is the **complete subagent prompt**, composed by the CLI. It already
     carries the skill invocation, the return contract, any step-specific clause,
     and the repository rules from `spok/MEMORY.md`. Do not rewrite, summarize, or
     add to it.

   If the response carries `memoryWarning`, surface it to the user once and continue.

4. Launch a subagent for the step with the **Agent** tool, passing `subagent_type: general-purpose`, `model: <step.model>`, (when present) `effort: <step.effort>`, and `<step.prompt>` **verbatim** as the prompt.

   Run subagents **sequentially in the foreground** — each step depends on the previous step's validated artifact or recorded result. Do not invoke the step skill inline: the subagent keeps each step's context isolated.

5. Record completion with the CLI.

   A `--summary` is recorded permanently in `workflow-state.json`. Do not relay a verification claim that cannot be attributed to a command that ran during the step. If the subagent reports "lint clean" or "tests pass" without naming the command it ran, drop the claim from the summary rather than passing it through — the CLI checks only that the summary is non-empty, so you are the last check on it.
   - File-producing steps (the CLI verifies `expectedOutput` exists and is non-empty):

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --json
     ```

   - `validate` additionally has its recorded verdict read from `validation.md` by the CLI: `PASS` completes the step. A `FAIL` with repair attempts remaining is a *successful* completion that routes to a `repair` step and then back to `validate` — the CLI may return `validate` more than once; complete every occurrence with the same bare `--step validate`. When repair attempts are exhausted and the verdict is still `FAIL`, `complete` (and subsequent `next`/`status`) return `state: "blocked"` with an exhausted-repair reason: report it exactly as returned — do not retry the step and do not edit `validation.md` to unblock it. An unreadable verdict blocks as before.

   - `implement`, `simplify`, and `repair` (dispatched like any other step when the CLI returns it):

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --summary "<summary>" --json
     ```

   - `commit`:

     ```bash
     spok flow complete "<task-dir>" --step "commit" --commit "<commit-sha>" --summary "<summary>" --json
     ```

   - `self-learn` is an optional file-producing advisory gate returned only when
     project config enables `flow.self_learn: true`. Complete it like any other
     file-producing step. Its findings do not fail or amend the commit.

6. If `complete` returns `state: "blocked"`, halt and report the `reason` exactly.

Do not restate or assume the step order — `spok flow next` is the only source of truth.
Do not derive or override model routing inside this skill — `spok flow next --json` is the source of truth, including `step.model` and `step.effort`.
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
