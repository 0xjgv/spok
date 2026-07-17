/**
 * Skill + Command Templates — spok-propose
 *
 * Scaffolds the change's planning artifacts (proposal, specs, design) via the
 * Spok CLI artifact graph, then hands off to `spok-create-scoped-chunks` which
 * writes a single `tasks.md` containing the chunk checklist.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const PROPOSE_INSTRUCTIONS = `Propose a new change and prepare it for chunked implementation.

This skill drives two phases:
1. Use the Spok CLI artifact graph to scaffold the change's planning artifacts
   (proposal, specs, design — everything except \`tasks\`).
2. Invoke the \`spok-create-scoped-chunks\` skill to slice the work into
   cross-layer, independently shippable chunks and write a single
   \`spok/changes/<name>/tasks.md\` checklist that \`spok-apply\` will consume.

---

**Input**: The user's request should include a change name (kebab-case) OR a description of what they want to build.

**CLI self-discovery**: When unsure about Spok's CLI surface, run \`spok capabilities --json\`. Use it only for discovery; keep the workflow recipe below as the primary path.

**Steps**

1. **If no clear input provided, ask what they want to build**

   Use the **AskUserQuestion tool** (open-ended, no preset options) to ask:
   > "What change do you want to work on? Describe what you want to build or fix."

   From their description, derive a kebab-case name (e.g., "add user authentication" → \`add-user-auth\`).

   **IMPORTANT**: Do NOT proceed without understanding what the user wants to build.

2. **Create the change directory**
   \`\`\`bash
   spok new change "<name>"
   \`\`\`
   This scaffolds the change directory at \`spok/changes/<name>/\` with \`.spok.yaml\`.

3. **Get the artifact build order**
   \`\`\`bash
   spok status --change "<name>" --json
   \`\`\`
   Parse the JSON to get:
   - \`artifacts\`: list of all artifacts with their status and dependencies.
   - \`planningHome\`, \`changeRoot\`, \`artifactPaths\`, and \`actionContext\`: path and scope context. Use these instead of assuming repo-local paths.

4. **Create planning artifacts in sequence (skip \`tasks\`)**

   Use the **TaskCreate tool** to track progress through the planning artifacts.

   Loop through artifacts in dependency order, but **skip the artifact whose id is \`tasks\`** — chunking will produce that file in step 5.

   For each non-\`tasks\` artifact that is \`ready\` (dependencies satisfied):
   - Get instructions:
     \`\`\`bash
     spok instructions <artifact-id> --change "<name>" --json
     \`\`\`
   - The instructions JSON includes:
     - \`context\`: Project background (constraints for you - do NOT include in output)
     - \`rules\`: Artifact-specific rules (constraints for you - do NOT include in output)
     - \`template\`: The structure to use for your output file
     - \`instruction\`: Schema-specific guidance for this artifact type
     - \`resolvedOutputPath\`: Resolved path or pattern to write the artifact
     - \`dependencies\`: Completed artifacts to read for context
   - Read any completed dependency files for context.
   - Create the artifact file using \`template\` as the structure and write it to \`resolvedOutputPath\`.
   - Apply \`context\` and \`rules\` as constraints - but do NOT copy them into the file.
   - Show brief progress: "Created <artifact-id>".

   If an artifact requires user input, use the **AskUserQuestion tool** to clarify, then continue.

5. **Hand off to chunking**

   Invoke the chunking skill with the change slug as its argument:

   > Call the \`spok-create-scoped-chunks\` skill with \`"<name>"\` as the argument using the **Skill tool**.

   The chunking skill will read the proposal/specs/design, present a chunk
   plan, iterate with the user, and write a single
   \`spok/changes/<name>/tasks.md\` containing one
   \`- [ ] N. <chunk title>\` per chunk with the chunk body indented beneath.

6. **Show final status**
   \`\`\`bash
   spok status --change "<name>"
   \`\`\`

**Output**

After the chunking skill finishes, summarize:
- Change name and location (\`spok/changes/<name>/\`)
- List of planning artifacts created
- The chunk count from \`tasks.md\`
- Prompt: "Run \`/spok-apply\` to ship the first chunk."

**Artifact Creation Guidelines**

- Follow the \`instruction\` field from \`spok instructions\` for each artifact type.
- The schema defines what each artifact should contain - follow it.
- Read dependency artifacts for context before creating new ones.
- Use \`template\` as the structure for your output file - fill in its sections.
- **IMPORTANT**: \`context\` and \`rules\` are constraints for YOU, not content for the file. Do NOT copy \`<context>\`, \`<rules>\`, \`<project_context>\` blocks into the artifact.

**Guardrails**
- Do NOT write \`tasks.md\` yourself. The chunking skill owns that file.
- Always read dependency artifacts before creating a new one.
- If context is critically unclear, ask the user — but prefer making reasonable decisions to keep momentum.
- If a change with that name already exists, ask whether to continue it or create a new one.
- Verify each artifact file exists after writing before proceeding to the next.`;

export function getProposeSkillTemplate(): SkillTemplate {
  return {
    name: 'spok-propose',
    description: 'Propose a new change: scaffold proposal/specs/design via the Spok CLI artifact graph, then invoke spok-create-scoped-chunks to slice the work into independently shippable chunks and write tasks.md.',
    instructions: PROPOSE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires spok CLI and the spok-create-scoped-chunks skill (vendored by spok init).',
    metadata: { author: 'spok', version: '2.0' },
  };
}

export function getProposeCommandTemplate(): CommandTemplate {
  return {
    name: 'Spok: Propose',
    description: 'Propose a new change and produce a chunked tasks.md',
    category: 'Workflow',
    tags: ['workflow', 'artifacts'],
    content: PROPOSE_INSTRUCTIONS,
  };
}
