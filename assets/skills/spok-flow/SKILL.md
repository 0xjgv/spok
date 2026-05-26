---
name: spok-flow
description: end-to-end research → design → plan → implement → review → commit workflow for a single chunk. Driven by spok-apply.
argument-hint: <task-dir> (absolute path to a pre-staged chunk directory containing ticket.md)
version: 0.3.0
---
# Flow Instructions

## 0. Receive Pre-Staged Task Directory

`spok-apply` has already created the task directory and written `ticket.md` for the chunk to execute. The argument to this skill is the **absolute path** to that directory (e.g. `spok/changes/<change-slug>/.flow/<chunk-slug>/`).

> Verify the directory exists and contains `ticket.md` using the **Read** tool. Do NOT recreate the directory or overwrite `ticket.md`.

If `ticket.md` is missing, halt and report back — `spok-apply` is responsible for staging it.

## Agent convention

For each workflow step below, launch the named agent with the **Agent** tool and `subagent_type: general-purpose`.
Run steps **sequentially in the foreground** because each step depends on the previous step's returned path.

## 1. Create Research Questions

Launch `lead-researcher-questions`.

> Call the `spok-create-research-questions` skill with the path to our ticket file as the argument using the **Skill** tool.
> When complete, return the **absolute path** of the research questions document that was created.

## 2. Create Research Document

Launch `lead-researcher`. Pass the absolute path of the research questions document returned by step 1.

> Call the `spok-create-research` skill with the path to our **research questions document only** as the argument using the **Skill** tool.
> When complete, return the **absolute path** of the research document that was created.

## 3. Create Design Discussion

Launch `lead-design-discussion`.

> Call the `spok-create-design-discussion` skill with the path to our task directory as the argument using the **Skill** tool.
> When complete, return the **absolute path** of the design discussion document that was created.

## 4. Create Structure Outline

Launch `lead-structure-outline`.

> Call the `spok-create-structure-outline` skill with the path to our task directory as the argument using the **Skill** tool.
> When complete, return the **absolute path** of the structure outline document that was created.

## 5. Create Plan

Launch `lead-plan`.

> Call the `spok-create-plan` skill with the path to our task directory as the argument using the **Skill** tool.
> When complete, return the **absolute path** of the plan document that was created.

## 6. Implement Plan

Launch `lead-implementer`.

> Call the `spok-implement-plan` skill with the path to our task directory as the argument using the **Skill** tool.
> When complete, return the summary of the implementation.

## 7. Simplify Implementation

Launch `lead-simplifier`.

> Call the `spok-code-review` skill with 'high' as the argument using the **Skill** tool.
> When complete, return the summary of the simplification.

## 8. Validate Implementation

Launch `lead-validator`.

> Call the `spok-validate-implementation` skill with the path to our task directory as the argument using the **Skill** tool.
> When complete, return the validation summary and recommendations.

## 9. Commit

Launch `lead-committer`.

> Call the `spok-ci-commit` skill using the **Skill** tool.
> When complete, return the commit hashes and summary.

<guidance>
## Important guidelines

- Raise questions or concerns about objectives, design, or plan to the user at any time using the **AskUserQuestion** tool.
- For each workflow step below, launch the named agent with the **Agent** tool.
- Run steps **sequentially in the foreground** because each step depends on the previous step's returned path.
- Use a **TaskList**.

</guidance>
