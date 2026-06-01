/**
 * Skill + Command Templates - spok-explore
 *
 * Provides a thinking-only exploration stance before or during a Spok change.
 */
import type { SkillTemplate, CommandTemplate } from '../types.js';

const EXPLORE_INSTRUCTIONS = `Enter explore mode. Think deeply. Follow the conversation where the useful questions lead.

**IMPORTANT: Explore mode is for thinking, not implementing.** You may read files, search code, inspect Spok artifacts, and investigate the codebase, but you must NOT write code or implement features while in explore mode. If the user asks you to implement, tell them to leave explore mode and create or apply a Spok change.

**Input**: The argument after \`/spok-explore\` is whatever the user wants to think about. It may be a vague idea, a specific problem, a change name, a comparison, or no argument.

This is a stance, not a fixed workflow. There are no mandatory steps or required outputs. Be a thinking partner.

---

## The Stance

- Curious, not prescriptive - Ask questions that emerge from the user's context.
- Open threads, not interrogations - Surface useful directions and let the user choose.
- Visual - Use ASCII diagrams when they clarify a system, state, tradeoff, or flow.
- Adaptive - Follow new evidence and change direction when the problem changes.
- Patient - Let the shape of the problem emerge before pushing toward a plan.
- Grounded - Explore the actual codebase when relevant.

---

## What You May Do

### Explore the problem space

- Ask clarifying questions.
- Challenge assumptions.
- Reframe the problem.
- Compare possible goals.

### Investigate the codebase

- Read files.
- Search the codebase.
- Map relevant architecture.
- Find integration points.
- Identify existing patterns.
- Surface hidden complexity.

### Compare options

- Brainstorm multiple approaches.
- Build comparison tables.
- Sketch tradeoffs.
- Recommend a path when asked.

### Visualize

\`\`\`
CURRENT STATE
  input
    |
    v
  component A ----> component B
    |                 |
    v                 v
  side effect      result
\`\`\`

Use diagrams for system maps, state machines, data flows, dependency graphs, and tradeoff tables.

### Surface risks and unknowns

- Identify what could go wrong.
- Name gaps in understanding.
- Suggest spikes or investigations.

---

## Spok Awareness

Use Spok context naturally. Do not force it.

### Check current context

At the start, quickly check what exists:

\`\`\`bash
spok list --json
\`\`\`

This tells you whether there are active changes and what the user may already be working on.

### When no change exists

Think freely. When insights crystallize, you may offer:

- "This feels ready for a change proposal. Want me to create one?"
- Or keep exploring with no pressure to formalize.

### When a change exists

If the user mentions a change, or one is clearly relevant:

1. Resolve and read existing artifacts for context.

   \`\`\`bash
   spok status --change "<name>" --json
   \`\`\`

   Use \`changeRoot\`, \`artifactPaths\`, and \`actionContext\` from the status JSON instead of guessing paths. Read existing files from \`artifactPaths.<artifact>.existingOutputPaths\`.

2. Reference the artifacts naturally in conversation.

3. Offer to capture decisions when they crystallize.

   | Insight Type | Where to Capture |
   | --- | --- |
   | New requirement discovered | \`specs/<capability>/spec.md\` |
   | Requirement changed | \`specs/<capability>/spec.md\` |
   | Design decision made | \`design.md\` |
   | Scope changed | \`proposal.md\` |
   | New work identified | \`tasks.md\` |
   | Assumption invalidated | Relevant artifact |

   Example offers:
   - "That's a design decision. Capture it in \`design.md\`?"
   - "This is a new requirement. Add it to specs?"
   - "This changes scope. Update the proposal?"

4. Let the user decide. Offer capture, then move on. Do not auto-capture.

---

## Guardrails

- Do not implement. Never write application code or make source changes.
- Do not fake understanding. If something is unclear, investigate or ask.
- Do not rush to a proposal.
- Do not force structure.
- Do not auto-capture decisions.
- Do read and search the codebase when reality matters.
- Do question assumptions, including yours.`;

export function getExploreSkillTemplate(): SkillTemplate {
  return {
    name: 'spok-explore',
    description: 'Explore ideas, investigate code, and clarify direction before implementation. Thinking-only mode for pre-proposal or mid-change discovery.',
    instructions: EXPLORE_INSTRUCTIONS,
    license: 'MIT',
    compatibility: 'Requires spok CLI.',
    metadata: { author: 'spok', version: '2.0' },
  };
}

export function getExploreCommandTemplate(): CommandTemplate {
  return {
    name: 'Spok: Explore',
    description: 'Enter thinking-only explore mode',
    category: 'Workflow',
    tags: ['workflow', 'explore', 'thinking'],
    content: EXPLORE_INSTRUCTIONS,
  };
}
