---
name: spok-execute
description: Execute a signed-off spok/specs/<spec-title>.md one vertical slice at a time. Each slice runs as a fresh autonomous subagent (research, plan, test-first implement, check, commit). Use after /spok-interview, in a fresh session.
argument-hint: <spec-title> (file name under spok/specs/, without .md)
license: MIT
metadata:
  author: spok
  version: "1.0"
---

# Spok Execute

You orchestrate. Subagents build. The spec file is the state machine; the human signed it off already, so do not ask the user anything inside the loop.

## Slice states

The `## Slices` checklist in `spok/specs/<spec-title>.md` holds all state. Only you change it:

| State | Line | Meaning |
| --- | --- | --- |
| pending | `- [ ] S2: <outcome>` | not started |
| done | `- [x] S2: <outcome> (<short-sha>)` | committed |
| blocked | `- [!] S2: <outcome>` + child `  - [!] blocked: <exact error>` | stopped the loop |

## 0. Preflight

- Read the spec in full. Missing file or no `## Slices` section: stop and tell the user to run `/spok-interview`.
- Any `[!]` slice present: stop. Report it. The user must fix the cause and reset it to `[ ]`.
- `git status --porcelain` must be empty apart from the spec file. Otherwise stop and report the dirty paths.

## 1. Loop

Repeat:

1. Pick the first `[ ]` slice. None left: go to step 2.
2. Spawn one fresh subagent (Agent tool) with the brief below. Run slices one at a time; later slices build on earlier commits.
3. Read its last line:
   - `done <sha>`: verify with `git log -1 --format=%h <sha>`. Flip the slice to `[x]` with the short sha.
   - `blocked: <error>`, or anything else: flip the slice to `[!]`, add the child line `  - [!] blocked: <exact error>`, and stop the loop. Later slices may depend on it.

Subagent brief (fill the placeholders):

> Implement slice `<slice-id>` of `<absolute spec path>`. Work autonomously; never ask the user. Do not touch other slices' checkboxes.
>
> **Research.** Read the spec in full. Locate the code this slice touches (use the `spok-codebase-locator` agent when the search is broad). Keep notes to one page, in your context only.
>
> **Plan.** Under the slice's item in the spec, add a nested `Plan:` list: files to change, the failing test to write first, the check to run. Keep it under 10 lines.
>
> **Implement.**
> 1. Write the failing test. Run it. Confirm it fails for the right reason.
> 2. Implement the minimum to pass it. Surgical changes; match existing style.
> 3. Run the slice's `Check:` command, then the project gate from the spec's Constraints.
> 4. On a red check, fix and re-run. At most 2 fix attempts. Still red: stop, leave the tree as is, and end with `blocked: <exact failing command and its first error line>`.
> 5. Green: stage only the files you changed (not the spec file) and commit with a conventional message naming the slice, e.g. `feat: <outcome> (<spec-title> <slice-id>)`. Do not push.
>
> End your reply with exactly one line: `done <commit sha>` or `blocked: <reason>`.

## 2. Finish

- All slices `[x]`: run every spec-level acceptance check. Record each result under a `## Run` section in the spec (command, pass/fail).
- Commit the spec file alone: `docs: update <spec-title> slice status`. Do not push.
- Report: each slice with its sha or its blocked error, the acceptance check results, and the next step (fix the blocker and re-run `/spok-execute <spec-title>`, or open a PR).
