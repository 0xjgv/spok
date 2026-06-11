---
name: spok-flow
description: end-to-end research → design → plan → implement → review → commit workflow for a single chunk. Driven by spok-apply.
argument-hint: <task-dir> (absolute path to a pre-staged chunk directory containing ticket.md)
version: 0.4.0
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
   - `argument` is the exact argument to pass to that skill.
   - `expectedOutput` is present for file-producing steps.

4. Launch a subagent for the step with the **Agent** tool, passing `subagent_type: general-purpose` and `model: <step.model>`:

   > Call the `<step.skill>` skill with `<step.argument>` as the argument using the **Skill** tool.
   > When complete, return the **absolute path** of the document that was created (file-producing steps) or a concise summary (other steps).

   Run subagents **sequentially in the foreground** — each step depends on the previous step's validated artifact or recorded result. Do not invoke the step skill inline: the subagent keeps each step's context isolated.

5. Record completion with the CLI:
   - File-producing steps (the CLI verifies `expectedOutput` exists and is non-empty):

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --json
     ```

   - `implement` and `simplify`:

     ```bash
     spok flow complete "<task-dir>" --step "<id>" --summary "<summary>" --json
     ```

   - `commit`:

     ```bash
     spok flow complete "<task-dir>" --step "commit" --commit "<commit-sha>" --summary "<summary>" --json
     ```

6. If `complete` returns `state: "blocked"`, halt and report the `reason` exactly.

Do not restate or assume the step order — `spok flow next` is the only source of truth.
Do not derive or override model routing inside this skill — `spok flow next --json` is the source of truth, including `step.model`.
In plain terms: spok flow next --json is the source of truth for model routing.

For `implement`, tell `spok-implement-plan` that it is running inside `spok-flow`: it must implement and verify the plan, return a summary, and must not create commits. The final commit belongs only to the `commit` step.

<guidance>
## Important guidelines

- Raise questions or concerns about objectives, design, or plan to the user at any time using the **AskUserQuestion** tool.
- Run step subagents **sequentially in the foreground** because each step depends on the previous step's validated artifact or recorded result.
- Let `spok flow next` choose the next step. Let `spok flow complete` validate step completion.
- Use a **TaskList** to track the steps and their status.

</guidance>
