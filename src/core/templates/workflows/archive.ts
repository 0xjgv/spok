/**
 * Skill + Command Templates — spok-archive
 *
 * Finalizes a change: warns on incomplete chunks/artifacts, syncs delta specs
 * unconditionally (folding what used to be a separate `sync-specs` skill into
 * archive), then moves the change directory under `changes/archive/`.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const ARCHIVE_INSTRUCTIONS = `Archive a completed Spok change.

This skill folds spec-sync into archive: any delta specs the change carries
are applied to the main specs before the change directory moves into the
archive. There is no separate sync step.

**Input**: Optionally specify a change name. If omitted, infer from
conversation context. If still ambiguous you MUST prompt the user.

**CLI self-discovery**: When unsure about Spok's CLI surface, run \`spok capabilities --json\`. Use it only for discovery; keep the workflow recipe below as the primary path.

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change.
   - Otherwise run \`spok list --json\` and use **AskUserQuestion** to let the user pick.

   Show only active changes (not already archived). Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select. Always let the user choose when ambiguous.

2. **Check artifact completion status**

   \`\`\`bash
   spok status --change "<name>" --json
   \`\`\`

   Parse the JSON to understand:
   - \`schemaName\`: The workflow being used.
   - \`planningHome\`, \`changeRoot\`, \`artifactPaths\`, \`actionContext\`: path and scope context.
   - \`artifacts\`: list of artifacts with their status (\`done\` or other).

   If status reports \`actionContext.mode: "workspace-planning"\`, explain that workspace archive is not supported in this slice and STOP. Do not move workspace changes into repo-local archives or edit linked repos.

   **If any artifacts are not \`done\`:**
   - Display warning listing incomplete artifacts.
   - Use **AskUserQuestion** to confirm.
   - Proceed if user confirms.

3. **Check chunk completion status**

   Read \`<changeRoot>/tasks.md\` and count top-level checkboxes:
   - \`- [ ]\` lines = incomplete chunks.
   - \`- [x]\` lines = shipped chunks.

   **If incomplete chunks found:**
   - Display warning showing count of incomplete chunks (with titles).
   - Use **AskUserQuestion** to confirm.
   - Proceed if user confirms.

   **If \`tasks.md\` is missing:** Proceed without a chunk-related warning.

4. **Apply delta specs unconditionally**

   Use \`artifactPaths.specs.existingOutputPaths\` from the status JSON to find delta spec files.

   **If no delta specs exist:** Skip to step 5.

   **If delta specs exist:**
   - For each delta spec at \`<changeRoot>/specs/<capability>/spec.md\`:
     - Locate the main spec at \`spok/specs/<capability>/spec.md\`.
     - Apply each delta section to the main spec, in order:
       - \`## ADDED Requirements\` — append new requirements.
       - \`## MODIFIED Requirements\` — replace existing requirements whose \`### Requirement:\` header text matches (whitespace-insensitive). MODIFIED blocks contain the full updated requirement; copy verbatim.
       - \`## REMOVED Requirements\` — delete the matching requirement block. Keep a \`<!-- removed: <reason> -->\` comment if the delta supplied a **Reason**.
       - \`## RENAMED Requirements\` — rename per FROM:/TO: pairs without changing scenarios.
     - If the main spec does not exist (new capability), copy the delta spec body to \`spok/specs/<capability>/spec.md\` (stripping the delta operation headers).
   - Show a per-capability summary of what was applied (count of adds/mods/removes/renames).

   Do NOT ask the user whether to sync. Sync is part of archive.

5. **Perform the archive move**

   Create the archive directory if needed:
   \`\`\`bash
   mkdir -p "<planningHome.changesDir>/archive"
   \`\`\`

   Generate the target name from today's date: \`YYYY-MM-DD-<change-name>\`.

   **Check if the target exists already:**
   - If yes: fail with a clear error. Suggest renaming the existing archive or using a different date.
   - If no: move the change directory:
     \`\`\`bash
     mv "<changeRoot>" "<planningHome.changesDir>/archive/YYYY-MM-DD-<name>"
     \`\`\`

6. **Display summary**

   \`\`\`
   ## Archive Complete

   **Change:** <change-name>
   **Schema:** <schema-name>
   **Archived to:** <planningHome.changesDir>/archive/YYYY-MM-DD-<name>/
   **Specs:** <one of: "Synced N capability spec(s)", "No delta specs">
   \`\`\`

   If any warnings were acknowledged in steps 2–3, append a **Warnings** section listing them.

**Guardrails**
- Always prompt for change selection if not provided.
- Use the artifact graph (\`spok status --json\`) for completion checking.
- Don't block archive on warnings — just inform and confirm.
- Sync delta specs unconditionally. Never ask whether to sync.
- Preserve \`.spok.yaml\` when moving (it moves with the directory).
- Show a clear summary of what happened.`;

export function getArchiveSkillTemplate(): SkillTemplate {
  return {
    name: 'spok-archive',
    description: 'Archive a completed Spok change. Applies any delta specs to the main specs unconditionally, then moves the change directory under changes/archive/.',
    instructions: ARCHIVE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires spok CLI.',
    metadata: { author: 'spok', version: '2.0' },
  };
}

export function getArchiveCommandTemplate(): CommandTemplate {
  return {
    name: 'Spok: Archive',
    description: 'Archive a completed change, applying any delta specs first',
    category: 'Workflow',
    tags: ['workflow', 'archive'],
    content: ARCHIVE_INSTRUCTIONS,
  };
}
