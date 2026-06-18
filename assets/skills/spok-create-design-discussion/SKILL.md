---
name: spok-create-design-discussion
description:  first step of planning
---

# Design Discussion Phase

You are now in the Design Discussion phase. Based on the research findings and the user's change request, work with them to make design decisions.

## Steps to follow after receiving the user's request

1. **Read all mentioned files immediately and FULLY**:
   - Ticket files (e.g., `<task-dir>/ticket.md`)
   - Research documents (e.g. `<task-dir>/research.md`)
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Check for related task content**:
   - The skill argument is the absolute path to the task directory. Use `ls <task-dir>` to enumerate its files.
   - Read all relevant files in the task directory to fully understand the work so far.

3. **Create a research todo list** using TodoWrite to track exploration tasks

4. **Spawn parallel sub-tasks for comprehensive research**:
   - Create multiple Task agents to research different aspects concurrently
   - Do not run agents in the background — FOREGROUND AGENTS ONLY.
   - Use the right agent for each type of research:

   **For deeper investigation:**
   - **codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **codebase-pattern-finder** - To find similar features we can model after

   Each agent knows how to:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

**Content guidance**: The template has `### Current State` for product/user-facing context (what the user sees, behaviors, UX gaps) and `### Current Architecture` for technical codebase details (file paths, function and type names). Populate each section with the appropriate type of content.

## Work with the user to iterate on the design

1. **Present patterns to follow** based on the research
   - Identify existing patterns in the codebase that should be followed
   - Include file locations and multiline code snippets showing the pattern

2. **Discuss design decisions**
   - For each major design choice, present options with pros/cons
   - Make recommendations based on codebase conventions
   - Record final decisions with rationale
   - If the research surfaced testing patterns for the components being changed, include a brief testing approach (e.g. "follow the existing unit test pattern in `__tests__/foo.test.ts`")

3. **If the user gives any input along the way**:
   - DO NOT just accept the correction
   - Spawn new research tasks to verify the correct information
   - Read the specific files/directories they mention
   - Only proceed with updates once you've verified the facts yourself
   - interpret ALL user feedback as instructions to update the document, not to begin implementation

## Output Format

1. **Read the design discussion Template**

`Read({SKILLBASE}/references/design_discussion_template.md)`

2. **Write the design discussion** to `<task-dir>/design-discussion.md`
   - Before writing, delete any sibling files matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-design-discussion.md` (legacy date-prefixed orphans from pre-fork runs).
   - The skill argument is the absolute path to the task directory (it already exists — do not create or search for it).
   - Filename is bare: `design-discussion.md` (no date prefix).
   - After writing, confirm the file exists and is non-empty: run `ls -la <task-dir>/design-discussion.md`. If missing or empty, re-write before continuing. Include the absolute path in your response.

3. **Read the final output template**

`Read({SKILLBASE}/references/design_discussion_final_answer.md)`

4.  Respond to the user with a summary following the template

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

## Document Precedence

When documents conflict, the most recent document wins:
**design discussion > research > ticket**

Decisions made during the design discussion supersede the original ticket description.
The ticket provides the initial request; the design discussion refines and finalizes the approach.
</guidance>
