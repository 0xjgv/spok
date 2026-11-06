---
name: spok-create-design-discussion
description: record consequential design decisions before structure planning
argument-hint: <task-dir> (absolute task directory containing ticket.md, research.md, and evidence/causal-paths.md)
license: MIT
metadata:
  author: spok
  version: "1.1"
---

# Design Discussion Phase

Based on the research, the causal-paths evidence, and the change request, lay out the design decisions for the user. Done when every consequential design question has been put to the user, the answered ones are recorded with rationale, and `design-discussion.md` is written in the task directory.

Only the user resolves a design question. You may recommend an option; never resolve a consequential question yourself, even when the research makes the answer look obvious. Under `spok flow`, this step is the flow's one human gate: the CLI collects the open design questions through the question packet, then asks the user to approve or revise the finished design.

## Steps to follow after receiving the user's request

1. **Read all mentioned files immediately and FULLY**:
   - Ticket files (e.g., `<task-dir>/ticket.md`), including its `## Claims`
   - Research documents (e.g. `<task-dir>/research.md`)
   - The causal-paths note at `<task-dir>/evidence/causal-paths.md`
   - When revising, the current `<task-dir>/design-discussion.md` or the preserved pre-answer draft the prompt names
   - **DO NOT read research questions documents** (`<task-dir>/research-questions.md`) - research questions are inputs to the research phase only, and stale questions contaminate the design context. Use the completed research document instead.
   - **IMPORTANT**: Use the Read tool WITHOUT limit/offset parameters to read entire files
   - **CRITICAL**: DO NOT spawn sub-tasks before reading these files yourself in the main context
   - **NEVER** read files partially - if a file is mentioned, read it completely

2. **Check for related task content**:
   - The skill argument is the absolute path to the task directory. Use `ls <task-dir>` to enumerate its files.
   - Read all relevant files in the task directory to fully understand the work so far, excluding research questions documents.

3. **Read the visual-evidence classification**:
   - Read `## Visual Evidence` from `<task-dir>/ticket.md` and use its classification and repository-relative packet path.
   - Treat a ticket without `## Visual Evidence` as a legacy ticket with classification `not-applicable`.
   - Accept only `required` or `not-applicable`. Stop and report any other value; do not ask a question that cannot repair the ticket itself.
   - For `required`, the packet path must be `spok/evidence/<change>/<chunk>/`, using the change and chunk slugs recorded in the ticket. Resolve it from the repository root; never place evidence under the task directory.

4. **Check the completion gate before drafting**:
   - If `<task-dir>/design-discussion.md` already exists and the prompt has neither injected human answers nor reviewer feedback, do not create or edit it. Its existence marks this flow step complete. Report the existing path and stop this phase.
   - When injected human answers are present, treat any existing design discussion as pre-answer output. Regenerate it after applying the answers instead of returning it as complete.
   - When the prompt says a reviewer requested changes, revise the existing document in place (see Revision mode).
   - Do not create or edit `<task-dir>/design-discussion.md` until every consequential decision is resolved by the user's answers and, when required, the visual-evidence packet is built, rendered, and verified. Under `spok flow`, the open questions travel in the question packet instead; outside the flow, see the standalone rule below.

5. **Inventory the design questions**:
   - List the decisions that materially affect behavior, scope, APIs, UX, compatibility, data, security, or tradeoffs.
   - Resolve code-answerable decisions from repository and research evidence. A fact the code answers is not a design question; do not ask about settled conventions or implementation detail owned by later phases.
   - Every remaining consequential decision is an open design question for the user.
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

## Shape the design questions

1. **Outline the product spec and the proposed end state**:
   - Current state, desired end state, and what we're not doing, in terms of user experience or functionality.
   - Under `## Proposed End State Architecture`, show the target with focused before-and-after diagrams, trees, pseudocode, or `diff` blocks from the visual guidance. Prefer `diff` when the key point is what changes; show the full target shape when it makes ownership or order clearer.

2. **Present each design question with options**:
   - Give two or three concrete options, each with pros, cons, and its consequence, and a recommendation grounded in codebase conventions.
   - End each option's consequence with `Rests on: <weakest premise> (verified|unverified)`, and name the observation that would change the pick.

3. **Place a defect fix at its cause**. When the ticket reports a defect:
   - Include options at the writer that produces the bad state, at a shared boundary, and at the reader that shows it, judged against the same promise. For each, name the consumers it leaves wrong and the evidence that would change the choice. A writer fix is not the same as new state or a migration.
   - Place the fix at the first wrong step `<task-dir>/evidence/causal-paths.md` names; steps below it get at most a guard.
   - If the note supports no single path, or records that the user chose to design without evidence, say so in the location question. Never present a location as right "whichever path" caused the defect.
   - When the note says `N/A: no defect`, skip this rule.

4. **Decide the Smallest Viable Control**. Include `## Smallest Viable Control`: at the fix location, compare the existing control surfaces (mechanisms, state, platform or upstream guarantees) with the proposed change, choose the least complex scope that satisfies the requirement, and explain why it meets the behavior contract. Justify any added state, flags, or cross-service controls by naming the failure an existing mechanism cannot prevent and what the added cost buys. State when no new control is needed. Small scope never moves the fix from the cause to where the symptom shows. When the choice is consequential, it is a design question like any other.

5. **Present patterns to follow** based on the research
   - Identify existing patterns in the codebase that should be followed
   - Include file locations and multiline code snippets showing the pattern
   - If the research surfaced testing patterns for the components being changed, include a brief testing approach (e.g. "follow the existing unit test pattern in `__tests__/foo.test.ts`")

## Put open questions to the user

1. **Inside `spok flow`, use the question packet**:
   - Do not ask or wait for the user directly. The isolated child cannot own the user conversation.
   - For the open design questions, write the structured question packet at the exact path supplied by the outer flow prompt, one question per open design question. Follow that prompt's strict schema and final `NEEDS_INPUT` line contract.
   - Use `choice` questions with the document's two or three options; set `recommendedOptionId` to the recommendation, and write each option's `consequence` so it ends `Rests on: <weakest premise> (verified|unverified)`. Name in the `prompt` the observation that would change the pick. Use `input` only when identity, content, a file path, or another genuinely free-form value is unavoidable.
   - Include every open design question in the packet. Do not create or edit `design-discussion.md`, and do not return a completion response in the same dispatch.
   - When no consequential question is open, write the document and complete normally; the CLI then asks the user to approve or revise it.

2. **Outside the flow**, the completion gate does not hold back the draft: write the document with every open question under `## Design Questions`, leave `## Resolved Design Questions` empty in a new document, and return. Raise any blocking clarification with AskUserQuestion.

## Apply the user's answers

1. **Consume durable answers from the outer flow**:
   - Read any prompt section headed `Human answers to earlier open questions. Treat these as authoritative:` before resolving the inventory.
   - Map each stable question id to the decision it represents. Any clear answer counts as a decision; the user need not say "resolve".
   - Repaint the decision inventory after applying the answers. On later question rounds, never reuse an answered question id.

2. **Verify feedback before applying it**. Answers about desired behavior, scope, and tradeoffs are authoritative human intent. A correction about the repository is not accepted blindly: read the files and directories it names, spawn subagents if you lack the facts, and proceed only once you have verified them yourself. Report a factual claim that the code contradicts instead of applying it.

3. **Revision mode**. When answers or reviewer feedback arrive:
   - Move each answered question to `## Resolved Design Questions` with the decision, its rationale, and the options not chosen, each with a brief reason it was discarded.
   - Update current state, desired end state, and the proposed architecture as the decisions require; add newly found patterns.
   - If an answer opens a new question, add it under `## Design Questions` as open. Under `spok flow`, put it in a new packet round with a new stable id.
   - Do not replace an earlier human decision because a later document was written.

4. **Synthesize only after the inventory is resolved**:
   - Restate the current end state, scope boundaries, and the decisions that constrain the design.
   - Confirm no consequential open decision remains before writing the final artifact under `spok flow`.
   - Record, for each resolved question, the user answer it follows, its evidence, and its rationale.

## Produce visual evidence when required

Complete this section after resolving the design decisions and before finalizing `design-discussion.md`. For `required`, build and open the visual evidence packet, verify the rendered comparison, and record the target decision before writing the discussion artifact.

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
   - Select the target from the ticket, research, resolved design answers, and verified comparison. Record its rationale, rejected alternatives, and verification evidence. When more than one target is credible and the choice is consequential, put it to the user as a design question; the CLI design gate reviews the result.
   - For every revision, set the manifest status back to `pending`, set `decision` to null, replace the target assets, regenerate the HTML, verify it, and reopen it. Delete superseded target assets so only the selected target is preserved.
   - After verification, set `status` to `verified` and set `decision` to `{ "selectedBy": "agent", "selectedAt": "<RFC 3339 timestamp>", "rationale": "<why this target satisfies the design>" }`. Include any explicit user input in the rationale without claiming human approval.
   - Add `## Visual Evidence` to `design-discussion.md`. Include the `verified` status, the target decision and its rationale, verification evidence, and a relative Markdown link from the document to the packet's `index.html`; also state the repository-relative packet path.

## Output Format

1. **Read the design discussion template and the visual guidance**

`Read({SKILLBASE}/references/design_discussion_template.md)`

`Read({SKILLBASE}/references/show-me.md)` and follow it while writing the artifact body.

- `show-me.md` governs the text views inside the discussion: pseudocode, call trees, component trees, file trees, and `diff` blocks. It does not govern the rendered-UI comparison, which stays owned by `## Produce visual evidence when required` and `design_evidence_template.html`.
- Use the smallest set of views needed to make the current state, the proposed end state, and each consequential decision clear. Place each view next to the short text it supports. Drop any view that does not help the user make a design decision.
- A Mermaid diagram stays subordinate to those text views and to the diagram gate: only when relationships among three or more components are materially clearer than concise prose.

2. **Write the design discussion** to `<task-dir>/design-discussion.md`
   - The skill argument is the absolute path to the task directory (it already exists — do not create or search for it).
   - Filename is bare: `design-discussion.md` (no date prefix).
   - Under `spok flow`, write only once the completion gate is satisfied. Do not create partial drafts, placeholders, or date-prefixed sibling artifacts.
   - Retain the template's `type: design-discussion` frontmatter.
   - Keep `## Design Questions` (open, or `None.` once the user has answered all of them) and `## Resolved Design Questions` (decision, rationale, options not chosen).
   - Organize cross-component deltas under `## System Design` and the in-code shape under `## Program Design`. Include the `## Visual Evidence` result produced above. For `required`, do not write the final document until the packet is verified and the target decision recorded.
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
- Implementation owns code detail only. It cannot override the resolved design.

Chronology does not determine authority. Use research and the ticket as evidence and starting context, not as automatic overrides. Resolve contradictions using the decision authority above and explicit user intent, then record the resolution. A contradiction that needs user intent is an open design question.
</guidance>
