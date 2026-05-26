---
name: research-codebase
description:  research the codebase 
---

# Research Codebase

You are tasked with conducting comprehensive research across the codebase to answer user questions by spawning parallel sub-agents and synthesizing their findings.

## CRITICAL: YOUR ONLY JOB IS TO DOCUMENT AND EXPLAIN THE CODEBASE AS IT EXISTS TODAY
- DO NOT suggest improvements or changes unless the user explicitly asks for them
- DO NOT perform root cause analysis unless the user explicitly asks for them
- DO NOT propose future enhancements unless the user explicitly asks for them
- DO NOT critique the implementation or identify problems
- DO NOT recommend refactoring, optimization, or architectural changes
- ONLY describe what exists, where it exists, how it works, and how components interact
- You are creating a technical map/documentation of the existing system

## Initial Setup:

When this command is invoked, respond with:
```
I'm ready to research the codebase. Please provide your research question or area of interest, and I'll analyze it thoroughly by exploring relevant components and connections.
```

Then wait for the user's research query.

## Steps to follow after receiving the research query:

1. **Read any directly mentioned files first:**
   - If the user mentions specific files (docs, JSON, research questions), read them FULLY first
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: Read these files yourself in the main context before spawning any sub-tasks
   - **DO NOT read ticket files** - research must stay objective about the current codebase, not be influenced by what a ticket wants to build. The research questions already capture what needs to be investigated.
   - This ensures you have full context before decomposing the research

2. **Analyze and decompose the research question:**
   - Break down the user's query into composable research areas
   - Take time to ultrathink about the underlying patterns, connections, and architectural implications the user might be seeking
   - Identify specific components, patterns, or concepts to investigate
   - Create a research plan using TodoWrite to track all subtasks
   - Consider which directories, files, or architectural patterns are relevant

3. **Spawn parallel sub-agent tasks for comprehensive research:**
   - Create multiple Task agents to research different aspects concurrently
   - We now have specialized agents that know how to do specific research tasks:

   **For codebase research:**
   - Use the **codebase-locator** agent to find WHERE files and components live
   - Use the **codebase-analyzer** agent to understand HOW specific code works 
   - Use the **codebase-pattern-finder** agent to find examples of existing patterns 

   **For web research (only if user explicitly asks):**
   - Use the **web-search-researcher** agent for external documentation and resources
   - IF you use web-research agents, instruct them to return LINKS with their findings, and please INCLUDE those links in your final report

   The key is to use these agents intelligently:
   - **Combine related questions**: Don't necessarily launch one subagent per research question. Group related questions that touch the same area of the codebase into a single subagent prompt. For example, if 3 questions are about how the daemon handles sessions, combine them into one codebase-analyzer call.
   - Aim for 2-6 well-scoped subagents rather than 1:1 question-to-agent mapping - this is not a hard rule, just guidance
   - Start with locator agents to find what exists
   - Then use analyzer agents on the most promising findings to document how they work
   - Run multiple agents in parallel when they're searching for **different areas** of the codebase
   - Each agent knows its job - just tell it what you're looking for
   - Don't write detailed prompts about HOW to search - the agents already know

4. **Wait for all sub-agents to complete and synthesize findings:**
   - IMPORTANT: Wait for ALL sub-agent tasks to complete before proceeding
   - Compile all sub-agent results
   - Prioritize live codebase findings as primary source of truth
   - Connect findings across different components
   - Include specific file paths and line numbers for reference
   - Verify all rpi/ paths are correct (task-specific files go in .humanlayer/tasks/)
   - Highlight patterns, connections, and architectural decisions
   - Answer the user's specific questions with concrete evidence

5. **Gather metadata for the research document:**
   - Filename: `.humanlayer/tasks/TASKNAME/YYYY-MM-DD-research.md`
     - First, find the task directory: `ls .humanlayer/tasks | grep -i "eng-XXXX"`
     - If the directory doesn't exist, create: `.humanlayer/tasks/ENG-XXXX-description/`
     - Format: `YYYY-MM-DD-research.md` where YYYY-MM-DD is today's date
     - Directory naming:
       - With ticket: `.humanlayer/tasks/ENG-1478-parent-child-tracking/2025-01-08-research.md`
       - Without ticket: `.humanlayer/tasks/authentication-flow/2025-01-08-research.md`

6. **Generate research document:**
   - Use the metadata gathered in step 4
   - Read the research template:

   `Read({SKILLBASE}/references/research_template.md)`

   - Write the document to `.humanlayer/tasks/TASKNAME/YYYY-MM-DD-research.md`

7. **Note cloud permalinks:**
   Cloud permalinks are automatically provided when you write artifacts. Include them in your final output.

   For code references in the synclayer repo (if on main or pushed):
   - Get repo info: `gh repo view --json owner,name`
   - Create permalinks: `https://github.com/{owner}/{repo}/blob/{commit}/{file}#L{line}`


8. **Respond to the user according to the template**
   - Read the final output template:
   `Read({SKILLBASE}/references/research_final_answer.md)`
   - Respond with a summary following the template, including GitHub permalinks.

9. **Handle follow-up questions:**
   - If the user has follow-up questions, append to the same research document
   - Update the frontmatter fields `last_updated` and `last_updated_by` to reflect the update
   - Add `last_updated_note: "Added follow-up research for [brief description]"` to frontmatter
   - Add a new section: `## Follow-up Research [timestamp]`
   - Spawn new sub-agents as needed for additional investigation
   - Continue updating the document 

<guidance>
## Important notes:
- Use parallel Task agents to maximize efficiency and minimize context usage
- Focus on finding concrete file paths and line numbers for developer reference
- Research documents should be self-contained with all necessary context
- Each sub-agent prompt should be specific and focused on read-only documentation operations
- Document cross-component connections and how systems interact
- Link to GitHub when possible for permanent references
- Stay focused on synthesis, not deep file reading
- Have sub-agents document examples and usage patterns as they exist
- **REMEMBER**: Document and Ask about what IS and WHY, not what SHOULD BE
- **NO RECOMMENDATIONS OR IMPLEMENTATION SUGGESTIONS**: Only describe the current state of the codebase
- **Testing patterns**: For each component area you research, document how it's currently tested (unit, integration, e2e). Include test file locations and patterns. The research template has a "Testing patterns" section under each component - always fill it in.
- **File reading**: Always read mentioned files FULLY (no limit/offset) before spawning sub-tasks
- **Critical ordering**: Follow the numbered steps exactly
  - ALWAYS read mentioned files first before spawning sub-tasks (step 1)
  - ALWAYS wait for all sub-agents to complete before synthesizing (step 4)
  - ALWAYS gather metadata before writing the document (step 5 before step 6)
  - NEVER write the research document with placeholder values
- **Path handling**: Task-specific research goes in .humanlayer/tasks/
  - Use `.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-research.md` for task research

## Response

Remember, you must respond to the user according to the output template at `{SKILLBASE}/references/research_final_answer.md`

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
</guidance>
