---
name: spok-flow
description: end-to-end problem validation → research → design → plan → implement → review → commit workflow for a single chunk, executed by delegating the whole loop to the `spok run` CLI command, with native or hybrid model routing. Driven by spok-apply.
argument-hint: [hybrid] <task-dir> (absolute path to a pre-staged chunk directory containing ticket.md)
version: 1.0.0
---
# Flow Instructions

## 1. Receive the task directory

`spok-apply` has already created the task directory and written `ticket.md` for the chunk to execute. The argument to this skill is the **absolute path** to that directory (e.g. `spok/changes/<change-slug>/.flow/<chunk-slug>/`). A leading `hybrid` token selects the built-in Claude + Codex execution profile; remove that token before resolving the path.

Verify the directory exists and contains `ticket.md` using the **Read** tool. If `ticket.md` is missing, halt and report back — `spok-apply` is responsible for staging it. Do NOT recreate the directory or overwrite `ticket.md`.

## 2. Run the flow

Execute the flow in the foreground with the host's shell tool:

```bash
spok run "<task-dir>" --json
```

When the `hybrid` token was present, append `--profile hybrid`:

```bash
spok run "<task-dir>" --json --profile hybrid
```

Do not background the command and do not run anything in parallel with it. Harness progress streams on stderr; stdout carries one JSONL event per line, each with `schemaVersion: 1`.

## 3. Relay the outcome

Report the run's result from its exit code and final JSONL event. Relay what the CLI reported; never invent or soften an outcome.

- **Exit 0** (`complete` event): report success to `spok-apply`, including the recorded commit when the event carries a `commit`.
- **Exit 2** (`blocked` event): report the event's `reason` verbatim. When the event carries `humanDecisions`, present that `## Human Decisions Required` content verbatim alongside the reason. Do not retry, and do not edit artifacts to unblock the flow.
- **Exit 3** (`step_failed` event): report the failure. Re-invoking the same command resumes at the same step.
- **Exit 1 or a signal code (130/143)**: report the error or cancellation verbatim.
- **A `warning` event**, at any point in the stream: surface its `message` to the user once and continue; a warning does not stop the run.

## Guardrails

`spok run` owns all execution semantics: step order, routing, models, prompt composition, harness dispatch, and completion recording. Do not choose, skip, reorder, or re-route steps; do not drive the flow state machine directly; do not construct harness invocations; do not restate routing, models, or step prompts.
