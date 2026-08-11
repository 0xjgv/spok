---
name: spok-create-structure-outline
description: create a phased implementation plan based on research and design decisions
---

# Create Structure Outline

You are creating a phased implementation plan based on research findings and design decisions.

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

## Steps

1. **Read all input documents FULLY**:
   - Use Read tool WITHOUT limit/offset to read the research document
   - Understand the current state of the codebase from research findings
   - Review all design decisions and patterns to follow

2. **Check for related task content**:
   - The skill argument is the absolute path to the task directory. Use `ls <task-dir>` to enumerate its files.
   - Read all files in the task directory.
   - Read relevant files mentioned in the task files.

3. **Use the current host's native subagent mechanism for follow-up research**:

   **For deeper investigation:**
   - **spok-codebase-locator**: Find additional files if needed
   - **spok-codebase-analyzer**: Deep-dive on specific implementations
   - **spok-codebase-pattern-finder**: Find more examples of patterns
   - **spok-web-search-researcher**: Research external best practices

   Run all subagents in the foreground only.

4. **Create a phased implementation plan**:
   - Break the work into logical phases
   - Each phase should be independently testable
   - Order phases vertically rather than horizontally - wire everything together in a testable way and then add functionality incrementally

5. **For each phase, specify**:
   - Overview of what's being built
   - Specific file changes with descriptions
   - Test file changes if the research found testing patterns for the components being modified (e.g. "add test in `__tests__/foo.test.ts` covering the new behavior")
   - Validation approach - how we'll verify the phase works

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

4. Respond to the user with a summary following the template

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

The goal of this document is to be concise and human readable. 
Be tasteful and thoughtful about how and where you include code snippets, and prefer highlighting signature changes rather than entire code blocks, unless the user explicitly asks for them. The structure outline is our "c header files", the plan will include the function definitions.


## Phase Validation Design

Not every phase requires manual validation, don't put steps for manual validation just to have them. 

There's a good chance that if a phase cannot be manually checked, the phase is either too small
or not vertical enough. The goal of manual validation is to avoid getting to the end of a 1000+ line
code change and then having to figure out which part went wrong.

Automated testing is always better than manual testing - be thoughtful based on your knowledge
of the codebase and testing patterns, and be clear about which tests are manual versus automated.

## Artifact Authority

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns decomposition only. It must conform to the design discussion.
- Plan owns implementation detail only. It cannot override the reviewed design.

Chronology does not determine authority. Unresolved or contradictory decisions block review and planning; surface them to the human and never silently override them.
</guidance>
