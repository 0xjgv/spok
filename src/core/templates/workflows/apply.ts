/**
 * Skill + Command Templates — spok-apply
 *
 * Picks the next unchecked chunk from \`spok/changes/<name>/tasks.md\`, stages
 * its ticket under \`.flow/<chunk-slug>/\`, and invokes the vendored \`spok-flow\`
 * skill to drive research → design → plan → implement → review → commit for
 * that single chunk.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const APPLY_INSTRUCTIONS = `Ship the next chunk of a Spok change end-to-end.

This skill picks one chunk from \`spok/changes/<name>/tasks.md\`, stages a
ticket file for it, and hands off to the vendored \`spok-flow\` skill which
runs research → design → plan → implement → review → commit on that single
chunk. On success the chunk's checkbox is ticked. On failure the run halts
so the user can intervene.

**Input**: Optionally specify a change name. If omitted, infer from
conversation context. If still ambiguous you MUST prompt the user.

**Steps**

1. **Select the change**

   - Use the change name argument if provided.
   - Otherwise infer from recent conversation.
   - Otherwise run \`spok list --json\` and use **AskUserQuestion** to let the user pick.
   - Auto-select if only one active change exists.

   Announce: "Using change: <name>". Tell the user how to override (e.g. \`/spok-apply <other-change>\`).

2. **Check workspace context**

   \`\`\`bash
   spok status --change "<name>" --json
   \`\`\`

   Parse the JSON to read:
   - \`planningHome.changesDir\` and \`changeRoot\` — use these instead of guessing paths.
   - \`actionContext.mode\` — if it is \`workspace-planning\` and \`allowedEditRoots\` is empty, explain that workspace apply is not supported here, treat linked repos as read-only context, and STOP before staging.

3. **Parse the chunked tasks.md**

   Read \`<changeRoot>/tasks.md\` (or follow the schema's \`tasks\` artifact path if different).

   The file is a flat list of chunks. Each chunk is a top-level checkbox line
   followed by an indented body:

   \`\`\`markdown
   - [ ] 1. <chunk title — one user-observable behavior>
       **Slug:** <chunk-slug>
       **Layers:** ...
       **Prerequisites:** ...
       **End-to-end test:** ...
       **Rollback:** ...

       <chunk body>
   - [ ] 2. <next chunk>
       ...
   - [x] 3. <already-shipped chunk>
       ...
   \`\`\`

   Find the **first** chunk whose checkbox is \`- [ ]\` (unchecked). Extract:
   - \`title\` — text after the number, before the newline.
   - \`slug\` — the \`**Slug:**\` field; fall back to a kebab-case slug of the title.
   - \`body\` — every indented line beneath the checkbox up to the next top-level checkbox.

   If every chunk is checked, congratulate the user and suggest \`/spok-archive\`. STOP.

4. **Honor prerequisites**

   If the chunk's \`**Prerequisites:**\` field lists slugs that are still
   unchecked elsewhere in \`tasks.md\`, halt with a clear error naming the
   missing prerequisite. Do not silently reorder.

5. **Stage the ticket**

   Create \`<changeRoot>/.flow/<chunk-slug>/\` and write a \`ticket.md\` file:

   \`\`\`markdown
   # <chunk title>

   ## Slug
   <chunk-slug>

   ## Layers
   <from tasks.md>

   ## End-to-end test
   <from tasks.md>

   ## Rollback
   <from tasks.md>

   ## Body
   <indented chunk body from tasks.md, dedented>

   ## Change Context
   - Change root: <changeRoot>
   - Proposal: <changeRoot>/proposal.md
   - Specs: <changeRoot>/specs/
   - Design: <changeRoot>/design.md (if it exists)
   \`\`\`

   Pass the **absolute path** to that ticket directory forward.

6. **Invoke spok-flow**

   > Call the \`spok-flow\` skill with the absolute path to the staged ticket directory as the argument using the **Skill tool**.

   The flow skill drives research → design → plan → implement → review → commit and returns when done or when it hits a blocker.

7. **Tick the checkbox on success / halt on failure**

   - On success: edit \`<changeRoot>/tasks.md\` and change \`- [ ]\` to \`- [x]\` for this chunk's line **only**. Do not touch other chunks.
   - On failure: leave the checkbox unchecked, surface the flow skill's error verbatim, and STOP. Do not roll back already-committed work.

8. **Show progress**

   After ticking, count remaining unchecked chunks and print:

   \`\`\`
   ## Chunk shipped: <title>

   Remaining: M/N unchecked
   Next: <next chunk title> (run \`/spok-apply\` again)
   \`\`\`

   If 0 remaining, suggest \`/spok-archive\`.

**Guardrails**
- Ship exactly **one** chunk per invocation. Do not loop through chunks.
- Never edit a chunk body in \`tasks.md\` — only flip the leading checkbox.
- If \`tasks.md\` is missing, tell the user to run \`/spok-propose\` first.
- If the parsed chunk is missing a slug or body, halt and ask the user to fix \`tasks.md\`.
- Preserve the \`actionContext.mode\` guard above; do not edit linked repos in workspace-planning mode.`;

export function getApplySkillTemplate(): SkillTemplate {
  return {
    name: 'spok-apply',
    description: 'Ship the next unchecked chunk from spok/changes/<name>/tasks.md end-to-end via the vendored spok-flow skill. Use when the user wants to implement the next chunk of a Spok change.',
    instructions: APPLY_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires spok CLI and the spok-flow skill (vendored by spok init).',
    metadata: { author: 'spok', version: '2.0' },
  };
}

export function getOpsxApplyCommandTemplate(): CommandTemplate {
  return {
    name: 'Spok: Apply',
    description: 'Ship the next chunk from tasks.md via spok-flow',
    category: 'Workflow',
    tags: ['workflow', 'apply'],
    content: APPLY_INSTRUCTIONS,
  };
}
