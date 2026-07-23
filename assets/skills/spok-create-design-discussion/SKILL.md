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

3. **Read the visual-evidence classification**:
   - Read `## Visual Evidence` from `<task-dir>/ticket.md` and use its classification and repository-relative packet path.
   - Treat a ticket without `## Visual Evidence` as a legacy ticket with classification `not-applicable`.
   - Accept only `required` or `not-applicable`. Stop and ask the user to correct any other value.
   - For `required`, the packet path must be `spok/evidence/<change>/<chunk>/`, using the change and chunk slugs recorded in the ticket. Resolve it from the repository root; never place evidence under the task directory.

4. **Create a research todo list** using TodoWrite to track exploration tasks

5. **Spawn parallel sub-tasks for comprehensive research**:
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

## Produce visual evidence when required

Complete this section after resolving the design decisions and before finalizing `design-discussion.md`.

### `not-applicable`

- Add `## Visual Evidence` to `design-discussion.md` and record that the ticket classifies visual evidence as `not-applicable`.
- Do not create an evidence packet.

### `required`

1. **Collect complete comparison rows**:
   - Create one current-versus-target row for every relevant interaction state and viewport. Each row records a label, state, viewport width and height, and both pane sources and alt text.
   - Capture the current UI as PNG with an available browser capability. If no browser capture capability is available, ask the user to supply the current image.
   - Prefer a target image exported or supplied by the user. Generate a target mockup only when the user requests one and a supported image capability is available.
   - Missing either the current or target pane blocks completion. Do not downgrade the classification because capture failed.

2. **Build a local, safe packet**:
   - Create `spok/evidence/<change>/<chunk>/index.html`, `manifest.json`, and `assets/` under the repository root.
   - Copy every displayed image into `assets/`; do not render remote URLs or files outside the packet. Accept PNG, JPEG, or WebP only. Browser captures must be PNG.
   - Remove credentials, tokens, personal data, and other sensitive content before copying an image. Preserve the original URL or file reference only as provenance text.
   - Use packet-relative paths such as `assets/current-default-1440x900.png`. Reject absolute paths and `..` traversal.

3. **Write the pending manifest first** using this contract:

   ```json
   {
     "schemaVersion": 1,
     "status": "pending",
     "change": "<change>",
     "chunk": "<chunk>",
     "approval": null,
     "comparisons": [
       {
         "label": "Default page",
         "state": "default",
         "viewport": { "width": 1440, "height": 900 },
         "current": {
           "path": "assets/current-default-1440x900.png",
           "source": "<original URL, file, or browser-capture description>",
           "alt": "<descriptive alt text>"
         },
         "target": {
           "path": "assets/target-default-1440x900.png",
           "source": "<original URL, file, or generation provenance>",
           "alt": "<descriptive alt text>"
         }
       }
     ]
   }
   ```

   Keep `approval` null while status is `pending`. Include at least one complete comparison row.

4. **Render and verify the comparison**:
   - Read `{SKILLBASE}/references/design_evidence_template.html` fully, then fill it to create `index.html`.
   - Keep CSS embedded, image references relative, and the page free of JavaScript and remote resources. Render each state/viewport as a responsive side-by-side current-versus-target row.
   - Verify `index.html`, `manifest.json`, and every declared image exist and are non-empty. Verify the HTML references both image paths from every manifest row.

5. **Open it for review**:
   - Use an available browser or open-file capability to open the generated `index.html`.
   - Otherwise try the platform launcher: `open` on macOS, `xdg-open` on Linux, or the Windows equivalent.
   - A launch failure is advisory. Print the absolute path to `index.html` when opening is unavailable or denied, then continue the approval conversation. Missing images remain blocking.

6. **Obtain and record approval**:
   - Present the target design approach and wait for explicit human approval that identifies the approver. Do not infer approval from silence or unrelated feedback.
   - For every requested revision, set the manifest status back to `pending`, set `approval` to null, replace the target assets, regenerate the HTML, verify it, and reopen it. Delete superseded target assets so only the final approved target is preserved.
   - After approval, set `status` to `approved` and set `approval` to `{ "approvedBy": "<identity>", "approvedAt": "<RFC 3339 timestamp>", "note": "<optional note>" }`.
   - Add `## Visual Evidence` to `design-discussion.md`. Include the `approved` status, approver identity, and a relative Markdown link from the document to the packet's `index.html`; also state the repository-relative packet path.

## Output Format

1. **Read the design discussion Template**

`Read({SKILLBASE}/references/design_discussion_template.md)`

2. **Write the design discussion** to `<task-dir>/design-discussion.md`
   - Before writing, delete any sibling files matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-design-discussion.md` (legacy date-prefixed orphans from pre-fork runs).
   - The skill argument is the absolute path to the task directory (it already exists — do not create or search for it).
   - Filename is bare: `design-discussion.md` (no date prefix).
   - Include the `## Visual Evidence` result produced above. For `required`, do not write the final document until the packet is approved.
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
