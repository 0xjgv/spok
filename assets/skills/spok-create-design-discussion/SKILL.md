---
name: spok-create-design-discussion
description:  first step of planning
---

# Design Discussion Phase

You are now in the Design Discussion phase. Based on the research findings and the user's change request, choose design decisions autonomously. You may ask questions when they would improve the result, using the outer flow's structured question protocol. There is no mandatory human approval or review gate.

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
   - Accept only `required` or `not-applicable`. Stop and report any other value; do not ask a question that cannot repair the ticket itself.
   - For `required`, the packet path must be `spok/evidence/<change>/<chunk>/`, using the change and chunk slugs recorded in the ticket. Resolve it from the repository root; never place evidence under the task directory.

4. **Check the completion gate before drafting**:
   - If `<task-dir>/design-discussion.md` already exists and the prompt has no injected human answers, do not create or edit it. Its existence marks this flow step complete. Report the existing path and stop this phase.
   - When injected human answers are present, treat any existing design discussion as pre-answer output. Regenerate it after applying the answers instead of returning it as complete.
   - Do not create or edit `<task-dir>/design-discussion.md` until every consequential decision is resolved and, when required, the visual-evidence packet is built, rendered, and verified.

5. **Inventory consequential decisions**:
   - List the unresolved decisions that materially affect behavior, scope, APIs, UX, compatibility, data, security, or tradeoffs.
   - Resolve facts from the repository and research before treating a point as a decision. Do not ask about settled conventions or implementation detail owned by later phases.
   - If the inventory is empty, state why the design is already determined by verified evidence.

6. **Research gaps before presenting a decision**:
   - Use the current host's native subagent mechanism to research distinct aspects concurrently.
   - Run every delegation in the foreground and wait for all results before continuing.
   - Use the right Spok subagent for each type of research:

   **For deeper investigation:**
   - **spok-codebase-locator** - To find more specific files (e.g., "find all files that handle [specific component]")
   - **spok-codebase-analyzer** - To understand implementation details (e.g., "analyze how [system] works")
   - **spok-codebase-pattern-finder** - To find similar features we can model after

   These subagents can:
   - Find the right files and code patterns
   - Identify conventions and patterns to follow
   - Look for integration points and dependencies
   - Return specific file:line references
   - Find tests and examples

**Content guidance**: The template has `### Current State` for product/user-facing context (what the user sees, behaviors, UX gaps) and `### Current Architecture` for technical codebase details (file paths, function and type names). Populate each section with the appropriate type of content.

## Resolve consequential decisions autonomously

1. **Consume durable answers from the outer flow**:
   - Read any prompt section headed `Human answers to earlier open questions. Treat these as authoritative:` before resolving the inventory.
   - Map each stable question id to the decision it represents. Treat answers about desired behavior, scope, and tradeoffs as authoritative human intent. Verify any factual claim about the repository against primary local evidence before relying on it.
   - Repaint the decision inventory after applying the answers. On later question rounds, never reuse an answered question id.

2. **Present patterns to follow** based on the research
   - Identify existing patterns in the codebase that should be followed
   - Include file locations and multiline code snippets showing the pattern

3. **Resolve evidence-owned decisions**:
   - Resolve code-answerable decisions from repository and research evidence.
   - Apply settled project conventions without asking permission. Choose the best-supported option for unresolved tradeoffs and record assumptions and uncertainty. Questions are optional when another perspective or clarification would materially improve the choice.
   - Record every resolved option, rationale, rejected tradeoff, and explicit scope boundary. Do not replace an earlier human decision because a later document was written.
   - Include `## Smallest Viable Control`: compare existing mechanisms and platform or upstream guarantees with the proposed change, identify the smallest viable scope, and explain why it satisfies the behavior contract. Justify any added state, flags, or cross-service controls by naming the failure an existing mechanism cannot prevent and what the added cost buys. State when no new control is needed.
   - If the research surfaced testing patterns for the components being changed, include a brief testing approach (e.g. "follow the existing unit test pattern in `__tests__/foo.test.ts`")

4. **Return genuine open questions to the outer flow**:
   - Do not ask or wait for the user directly. The isolated child cannot own the user conversation.
   - If a question would improve the result, write the structured question packet at the exact path supplied by the outer flow prompt. Follow that prompt's strict schema and final `NEEDS_INPUT` line contract. Questions can clarify intent, test a tradeoff, or request useful context; they are not limited to missing human intent.
   - Prefer `choice` questions with two or three concrete options, consequences, and an evidence-backed recommendation. Use `input` only when identity, content, a file path, or another genuinely free-form value is unavoidable.
   - Include the independent questions worth asking in the packet. Do not create or edit `design-discussion.md`, and do not return a completion response in the same dispatch.
   - On redispatch, consume the injected answers, repaint the inventory, and either finish autonomously or emit a new round with new stable ids. Never re-emit an answered question.

5. **Synthesize only after the inventory is resolved**:
   - Restate the current end state, scope boundaries, and the decisions that constrain the design.
   - Confirm no consequential open decision remains before drafting the final artifact.
   - Record whether each decision follows explicit user input or an autonomous choice, with its evidence and rationale.

## Produce visual evidence when required

Complete this section after resolving the design decisions and before finalizing `design-discussion.md`. For `required`, build and open the visual evidence packet, verify the rendered comparison, and record the autonomous design decision before writing the discussion artifact.

### `not-applicable`

- Add `## Visual Evidence` to `design-discussion.md` and record that the ticket classifies visual evidence as `not-applicable`.
- Do not create an evidence packet.

### `required`

1. **Collect complete comparison rows**:
   - Create one current-versus-target row for every relevant interaction state and viewport. Each row records a label, state, viewport width and height, and both pane sources and alt text.
   - Capture the current UI as PNG with an available browser capability. If no browser capture capability is available, request the current image through a new structured question round; do not ask directly.
   - Use a target image exported or supplied by the user when available. Otherwise build and render a local target prototype using the researched design system, or use a supported image capability for a target mockup. Record its provenance and the design choice it illustrates.
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
     "decision": null,
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

   Keep `decision` null while status is `pending`. Include at least one complete comparison row.

4. **Render and verify the comparison**:
   - Read `{SKILLBASE}/references/design_evidence_template.html` fully, then fill it to create `index.html`.
   - Keep CSS embedded, image references relative, and the page free of JavaScript and remote resources. Render each state/viewport as a responsive side-by-side current-versus-target row.
   - Verify `index.html`, `manifest.json`, and every declared image exist and are non-empty. Verify the HTML references both image paths from every manifest row.
   - Render the packet with an available browser capability and inspect every comparison for matching states, viewport dimensions, image loading, and intended design changes. Record what was checked; file existence alone is not visual verification. If rendering is unavailable, report the missing capability and leave the packet pending.

5. **Open the comparison**:
   - Use an available browser or open-file capability to open the generated `index.html`.
   - Otherwise try the platform launcher: `open` on macOS, `xdg-open` on Linux, or the Windows equivalent.
   - A launch failure is advisory. Print the absolute path to `index.html` when opening is unavailable or denied. This does not waive rendering and verification; missing images remain blocking.

6. **Record the design decision**:
   - Select the target autonomously from the ticket, research, and verified comparison. Record its rationale, rejected alternatives, and verification evidence. Ask through the structured question protocol when useful; user review is optional.
   - For every revision, set the manifest status back to `pending`, set `decision` to null, replace the target assets, regenerate the HTML, verify it, and reopen it. Delete superseded target assets so only the selected target is preserved.
   - After verification, set `status` to `verified` and set `decision` to `{ "selectedBy": "agent", "selectedAt": "<RFC 3339 timestamp>", "rationale": "<why this target satisfies the design>" }`. Include any explicit user input in the rationale without claiming human approval.
   - Add `## Visual Evidence` to `design-discussion.md`. Include the `verified` status, the autonomous decision and its rationale, verification evidence, and a relative Markdown link from the document to the packet's `index.html`; also state the repository-relative packet path.

## Output Format

1. **Read the design discussion Template**

`Read({SKILLBASE}/references/design_discussion_template.md)`

2. **Write the design discussion** to `<task-dir>/design-discussion.md`
   - The skill argument is the absolute path to the task directory (it already exists — do not create or search for it).
   - Filename is bare: `design-discussion.md` (no date prefix).
   - Write only once the completion gate is satisfied. Do not create partial drafts, placeholders, or date-prefixed sibling artifacts.
   - Retain the template's `type: design-discussion` frontmatter.
   - Organize cross-component deltas under `## System Design` and the in-code shape under `## Program Design`. Include the `## Visual Evidence` result produced above. For `required`, do not write the final document until the packet is verified and the design decision recorded.
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

## Decision Authority and Conflicts

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns decomposition only. It must conform to the design discussion.
- Plan owns implementation detail only. It cannot override the resolved design.

Chronology does not determine authority. Use research and the ticket as evidence and starting context, not as automatic overrides. Resolve contradictions using the decision authority above and explicit user intent, then record the resolution. Ask through the structured question protocol when useful; do not require human review to advance.
</guidance>
