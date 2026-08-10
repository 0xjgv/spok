---
name: spok-create-plan
description: convert structure outline into a detailed implementation plan
---

# Create Plan

You are in the final Plan Writing phase. Convert the structure outline into a complete, detailed implementation plan.

## Steps

1. **Read all input files FULLY**:
   - Use Read tool WITHOUT limit/offset to read all provided file paths
   - The skill argument is the absolute path to the task directory. Use `ls <task-dir>` to enumerate all related documents.
   - Read everything in the task directory to build full context
   - Verify the expected typed frontmatter before planning:
     - `<task-dir>/design-discussion.md`: `type: design-discussion`
     - `<task-dir>/structure-outline.md`: `type: structure-outline`
     - `<task-dir>/design-review.md`: `type: design-review` and `verdict: PASS`
   - If the design review is missing, unreadable, not a `PASS`, or records unresolved or contradictory decisions, stop. Unresolved or contradictory decisions block review and planning; do not silently override them.

2. **Read relevant code files**:
   - Read any source files mentioned in the research, design, or structure documents
   - Build context for writing specific code examples

3. **Read the plan template**:

`Read({SKILLBASE}/references/plan_template.md)`

4. **Write the implementation plan**:
   - Before writing, delete any sibling files matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-plan.md` (legacy date-prefixed orphans from pre-fork runs).
   - Write to `<task-dir>/plan.md` (bare filename; the task directory is the absolute path passed as the skill argument and already exists)
   - The output must retain the plan template's `type: plan` frontmatter.
   - After writing, confirm the file exists and is non-empty: run `ls -la <task-dir>/plan.md`. If missing or empty, re-write before continuing. Include the absolute path in your response.
   - Convert each phase from the structure outline into detailed implementation steps
   - Include specific code examples for each change
   - Add both automated and manual success criteria

## Plan Writing Guidelines

- Each phase should be independently testable
- Include specific code examples, not just descriptions
- Automated verification should be runnable commands
- Every automated-verification command must come from the repository's manifest (`package.json` scripts, `Makefile` targets, or the equivalent) or from `research.md`. Never name a command from a toolchain guess — do not write `bunx <tool>` or `npx <tool>` for a tool you have not confirmed this repository configures.
- If research did not establish the commands, say so plainly in the plan ("research did not establish the lint command; confirm before running"). Do not hedge with a conditional like "if configured" — a hedged command reads as approved and gets run anyway.
- Manual verification should be specific, actionable steps
- Pause for human confirmation between phases
- If the research documented testing patterns for the components being changed, include test code in the plan (new test files or additions to existing test files). Follow the existing test patterns found in the research.

## Artifact Authority

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns decomposition only. It must conform to the design discussion.
- Plan owns implementation detail only. It cannot override the reviewed design.

Chronology does not determine authority. Unresolved or contradictory decisions block review and planning; surface them to the human and never silently override them.

## Output

1. **Read the final output template**:

`Read({SKILLBASE}/references/plan_final_answer.md)`

2. Respond with a summary following the template

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

## Validation Design

Not every phase requires manual validation, don't put steps for manual validation just to have them. 
</guidance>
