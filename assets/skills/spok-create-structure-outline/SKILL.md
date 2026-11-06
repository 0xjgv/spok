---
name: spok-create-structure-outline
description: create executable implementation phases based on research and resolved design decisions
argument-hint: <task-dir> (absolute task directory containing research.md and the user-resolved design-discussion.md)
license: MIT
metadata:
  author: spok
  version: "1.1"
---

# Create Structure Outline

You are creating the executable structure outline based on research findings and resolved
design decisions. Flows implement this outline directly; do not defer required
behavior, interfaces, tests, or validation to a later plan.

Build only on resolved decisions. Every design question in `design-discussion.md`
was resolved by the user at the design gate. If you find a design question still
open (an entry under `## Design Questions` other than `None.`, or a consequential
choice the design leaves undecided), stop and return that question instead of an
outline. Do not decide it yourself.

## Input

- `changeRequest`: The user's original change request
- `researchDocumentPath`: Path to the research document (e.g., `<task-dir>/research.md`)
- `designDecisions`: List of design decisions made during the design discussion phase
- `patternsToFollow`: List of patterns identified during research

The relevant task artifacts must have their expected YAML frontmatter types:

- `<task-dir>/research.md`: `type: research`
- `<task-dir>/design-discussion.md`: `type: design-discussion`
- `<task-dir>/structure-outline.md` output: `type: structure-outline`

Verify these types before writing. Stop and report a missing or mismatched type; do not infer an artifact's authority from its filename.

Use the supplied execution work root when present for repository evidence and validation
command paths. Keep task artifacts at the supplied absolute task directory. Do not select
another repository or establish implementation execution metadata yourself.

## Steps

1. **Read all input documents FULLY**:
   - Use Read tool WITHOUT limit/offset to read the research document
   - Understand the current state of the codebase from research findings
   - Review all design decisions and patterns to follow
   - **DO NOT read research questions documents** (`<task-dir>/research-questions.md`) - research questions are inputs to the research phase only, and stale questions contaminate the design context. Use the completed research document instead.

2. **Check for related task content**:
   - The skill argument is the absolute path to the task directory. Use `ls <task-dir>` to enumerate its files.
   - Read all files in the task directory except research questions documents.
   - Read relevant files mentioned in the task files.

3. **Use the current host's native subagent mechanism for follow-up research**:

   **For deeper investigation:**
   - **spok-codebase-locator**: Find additional files if needed
   - **spok-codebase-analyzer**: Deep-dive on specific implementations
   - **spok-codebase-pattern-finder**: Find more examples of patterns
   - **spok-web-search-researcher**: Research external best practices

   Run all subagents in the foreground only.

4. **Read the visual guidance, then create a phased implementation plan**:
   - Before drafting any phase, `Read({SKILLBASE}/references/show-me.md)` and follow it while writing the artifact body
   - Use the smallest set of visual views needed for each phase instead of a flat list of files and changes
   - Tell the story of each phase in the order that makes it easiest to understand: show files first when ownership gives the needed context, or establish the key data structure, SQL table, or API contract first when it explains the rest of the change
   - Treat every view and subheading as optional. Choose and order them from the change, not from a fixed template. Write it as one human writes to another
   - Place a short description between views so the outline explains why the next shape matters
   - Use `diff` blocks for focused changes to existing shapes; use language-specific or `text` blocks for complete target shapes that are new, high-level, or clearer without diff notation
   - Use proper tree glyphs (`├──`, `└──`, and `│`), not ASCII substitutes
   - In `diff` blocks, start added and changed (`~`) lines with `+`, removed lines with `-`, and unchanged context lines with a space
   - Keep trees small enough to scan. Group related files under their shared directory and omit unchanged paths unless they give needed context
   - A Mermaid diagram stays subordinate to the text views and to the diagram gate: only when relationships among three or more components are materially clearer than concise prose
   - Break the work into logical phases
   - Each phase should be independently testable
   - Order phases vertically rather than horizontally - wire everything together in a testable way and then add functionality incrementally

   **Order phases vertically.**

   Each phase should be a thin vertical slice that touches as many layers of the desired end state as it can. Avoid horizontal phases like 'add all types', 'add API endpoints', 'implement UI'.

   A horizontal breakdown looks like this:

   1. Build the schema
   2. Build the API
   3. Build the UI
   4. Add tests

   That creates handoff problems and partially finished work.

   A vertical slice cuts through the stack:

   1. User can create the simplest version of the thing end-to-end
   2. User can edit one field end-to-end
   3. User can see the first validation error end-to-end

   Each slice includes the schema, API, UI, and tests it needs.

   These are **illustrative**. Not all work fits this shape, but cross module boundaries where you can so surprises surface early. **Do not structure a phase N such that Phase N+1 must be completed before Phase N can be verified.** Each phase must be independently verifiable from typechecks, tests, build steps, and other in-repo verification. Never propose a manual step for something a script, existing check, or existing skill can automate.

5. **For each phase, specify**:
   - Required observable behavior and completion conditions, traced to `ticket.md` and the resolved design; name relevant constraints and failure cases
   - `Implements:` one line naming the resolved design decision title(s) from `design-discussion.md` that this phase delivers
   - A compact `### Change Outline`: prose first, then only the views that explain the phase - an optional `diff` file tree when file ownership matters, and focused views for key data structures, SQL tables, API contracts, or signature changes
   - Affected repository areas and their responsibilities, including interface inputs, outputs, error behavior, ownership, and cross-module wiring where relevant; record phase prerequisites without deferring a phase's verification to later work
   - Concrete test changes covering the required behavior and failure cases. Ground test locations, fixtures, and conventions in actual repository tests; label proposed new files as new. If no relevant tests exist, inspect the repository's test setup and specify an executable approach rather than inventing an existing pattern
   - List every phase title under `## Implementation Overview` as `- [ ] Phase N: [Title]`. Implementation ticks each one to `- [x]` and marks the phase heading ✅ when its verification passes, so leave them all unchecked
   - `### Validation` with `#### Automated Verification` checkboxes containing exact commands, working directories, and expected outcomes. Verify command names and options against current repository scripts, configuration, or tool help; cite that evidence. Research notes alone do not prove a command exists. Proposed new tests may be named, but their runner must be verified
   - If no runnable command can be confirmed for a required check, state that plainly and identify the missing check as a blocker; do not hedge with a conditional such as "if configured"
   - `#### Manual Verification` only for checks requiring human judgment that cannot be automated

   Before finishing, map every required ticket behavior and resolved design decision to
   a phase and its verification. Repair missing coverage. Record consequential unresolved
   choices as blockers; do not silently decide user intent or describe a blocked outline
   as implementation-ready. Inside a flow, use its supplied durable question protocol
   when clarification is needed, ending the response with its `NEEDS_INPUT` marker and
   consuming durable answers on redispatch; when running under `spok flow`, raise it
   through the flow's question packet. Standalone, ask the user directly with
   AskUserQuestion and keep the outline blocked until the consequential choice is resolved.

6. **Document what's out of scope**:
   - What we're NOT doing in this plan
   - Future enhancements to consider later


## Output Document

1. **Read the structure outline template**

`Read({SKILLBASE}/references/structure_outline_template.md)`

2. **Write the structure outline** to `<task-dir>/structure-outline.md`
   - Before writing, delete any sibling files matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-structure-outline.md` (legacy date-prefixed orphans from pre-fork runs).
   - The skill argument is the absolute path to the task directory (it already exists — do not create or search for it).
   - Filename is bare: `structure-outline.md` (no date prefix).
   - After writing, confirm the file exists and is non-empty: run `ls -la <task-dir>/structure-outline.md`. If missing or empty, re-write before continuing. Include the absolute path in your response.

3. **Read the final output template**

`Read({SKILLBASE}/references/structure_outline_final_answer.md)`

4. Respond to the user with a summary following the template. In a flow, return the
   artifact to the caller, which completes the step and uses
   `spok flow next "<task-dir>" --json` to select the next stage. Do not hardcode
   implementation as the handoff; the CLI owns the sequence.

## Work with the user to iterate on the design

3. **If the user gives any input along the way**:
   - DO NOT just accept the correction
   - Use the current host's native subagent mechanism to run new research tasks in the foreground and verify the correct information
   - Read the specific files/directories they mention
   - Only proceed once you've verified the facts yourself
   - interpret ALL user feedback as instructions to update the document, not to begin implementation
   - Update the structure according to the user's feedback

<guidance>
## Markdown Formatting

When writing markdown files that contain code blocks showing other markdown (like README examples or SKILL.md templates), use 4 backticks (````) for the outer fence so inner 3-backtick code blocks don't prematurely close it:

````markdown
# Example README
## Installation
```bash
npm install example
```
````

## Phase changes should be concise but clear

The goal of this document is to be concise, human readable, and executable without a
separate plan. Prefer signatures and focused code shapes to whole function bodies.
Show a full type or data structure only when its shape is the decision. Specify enough
behavior, ownership, interfaces, tests, and commands for implementation without reopening
design decisions; do not expand the outline into line-by-line coding instructions.


## Phase Validation Design

Each phase has a `### Validation` section with two subsections:

- `#### Automated Verification`: runnable commands (typecheck, tests, lint) as a checkbox list
- `#### Manual Verification`: steps that need human judgment, as a checkbox list

Command verification establishes that the command is supported; it does not mean the
tests ran or passed. Leave checks unchecked until execution and never claim results
without the command and observed outcome.

Not every phase requires manual validation, don't put steps for manual validation just to have them. 

There's a good chance that if a phase cannot be manually checked, the phase is either too small
or not vertical enough. The goal of manual validation is to avoid getting to the end of a 1000+ line
code change and then having to figure out which part went wrong.

Automated testing is always better than manual testing - be thoughtful based on your knowledge
of the codebase and testing patterns, and be clear about which tests are manual versus automated.

## Artifact Authority

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns executable phase decomposition, affected areas, interfaces,
  test coverage, and validation commands. It must conform to the design discussion.

Chronology does not determine authority. Unresolved or contradictory decisions block
readiness until reconciled against artifact authority and explicit user intent. Record
evidence-backed resolutions of facts. A contradiction that needs user intent is an open
design question: stop and return it as described above. Never silently override the
user-resolved design.
</guidance>
