---
name: spok-create-design-discussion
description:  first step of planning
---

# Design Discussion Phase

You are now in the Design Discussion phase. Based on the research findings and the user's change request, work with them to make design decisions.

## Steps to follow after receiving the user's request

1. **Read all mentioned files immediately and FULLY**:
   - Ticket files (e.g., `.humanlayer/tasks/eng-1234-description/ticket.md`)
   - Research documents (e.g. `.humanlayer/tasks/eng-1234-description/research.md`)
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Check for related task content**:
   - if a path in `.humanlayer/tasks/TASKNAME` is mentioned, use Bash(`ls .humanlayer/tasks/TASKNAME`)
   - **IMPORTANT** DO NOT USE search or glob or grep, as .humanlayer/tasks may be a symlink and those tools don't traverse symlinks
   - read all relevant files in the task directory to fully understand the work so far

3. **Create a research todo list** using TodoWrite to track exploration tasks

4. **Spawn parallel sub-tasks for comprehensive research**:
   - Create multiple Task agents to research different aspects concurrently
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

**Content guidance**: The template has two Current State sections — `### Current State` for product/user-facing context (what the user sees, behaviors, UX gaps) and `### Current State (Code)` for technical codebase details (file paths, function and type names). Populate each section with the appropriate type of content.

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

2. **Write the design discussion** to `.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-design-discussion.md`
   - First, find the task directory: `ls .humanlayer/tasks | grep -i "eng-XXXX"`
   - If the directory doesn't exist, create: `.humanlayer/tasks/ENG-XXXX-description/`
   - Format: `YYYY-MM-DD-design-discussion.md` where YYYY-MM-DD is today's date
   - Directory naming:
     - With ticket: `.humanlayer/tasks/ENG-1478-parent-child-tracking/2025-01-08-design-discussion.md`
     - Without ticket: `.humanlayer/tasks/improve-error-handling/2025-01-08-design-discussion.md`

3. **Read the final output template**

`Read({SKILLBASE}/references/design_discussion_final_answer.md)`

4.  Respond to the user with a summary following the template, including GitHub permalinks

<guidance>
## Cloud Permalinks

When you write or edit documents in .humanlayer/tasks/, a cloud permalink is automatically provided in the hook response.
- The permalink appears as `additionalContext` after Write/Edit/MultiEdit/Read operations
- Use this permalink in your final output for easy navigation
- Example format: `http(s)://{DOMAIN}/artifacts/{artifactId}`

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
