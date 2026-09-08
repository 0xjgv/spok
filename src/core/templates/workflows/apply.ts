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

**Input**: Optionally specify an execution mode followed by a change name:
- no arguments — use the current tool for every flow step and infer the change
- \`<change>\` — use the current tool and select that change
- \`hybrid\` — use the built-in Claude + Codex profile and infer the change
- \`hybrid <change>\` — use the built-in Claude + Codex profile for that change
- \`auto\` — let the deterministic flow controller route each step and infer the change
- \`auto <change>\` — let the deterministic flow controller route each step for that change

Treat an exact leading \`hybrid\` or \`auto\` token as the execution mode and remove
it before selecting the change. Both tokens are reserved. If the change is still
ambiguous you MUST prompt the user.

**CLI self-discovery**: When unsure about Spok's CLI surface, run \`spok capabilities --json\`. Use it only for discovery; keep the workflow recipe below as the primary path.

**Steps**

1. **Select the change**

   - Record whether the leading argument selected hybrid or auto execution.
   - Use the remaining change name argument if provided.
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
       **Visual evidence:** <required | not-applicable>
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
   - \`visualEvidence\` — the \`**Visual evidence:**\` field. Accept only the exact
     values \`required\` and \`not-applicable\`. If the field is absent, default it to
     \`not-applicable\` for legacy chunks. If the field is present with any other value,
     halt with a clear error naming the invalid value; do not stage the ticket.
   - \`body\` — every indented line beneath the checkbox up to the next top-level checkbox.

   If every chunk is checked, skip steps 4–8 and go directly to step 9 to
   publish or retry publication. Do not stage a ticket or invoke flow again.
   An empty chunk list is an error; ask the user to fix \`tasks.md\` and STOP.

4. **Honor prerequisites**

   If the chunk's \`**Prerequisites:**\` field lists slugs that are still
   unchecked elsewhere in \`tasks.md\`, halt with a clear error naming the
   missing prerequisite. Do not silently reorder.

5. **Stage the ticket**

   Before staging, verify every harness that will execute the flow steps can
   discover the Spok helper closure:
   - Resolve the project root with \`git rev-parse --show-toplevel\`.
   - Each harness's installation markers:
     - Claude: \`<project-root>/.claude/skills/spok-flow/SKILL.md\` or
       \`~/.claude/skills/spok-flow/SKILL.md\`, and
       \`<project-root>/.claude/skills/spok-review-design/SKILL.md\` or
       \`~/.claude/skills/spok-review-design/SKILL.md\`.
     - Codex: \`<project-root>/.agents/skills/spok-flow/SKILL.md\` or
       \`~/.agents/skills/spok-flow/SKILL.md\`, and
       \`<project-root>/.agents/skills/spok-review-design/SKILL.md\` or
       \`~/.agents/skills/spok-review-design/SKILL.md\`.
   - Default execution (\`no arguments\` / \`<change>\`) uses the current tool for
     every step — check only that harness's markers.
   - Before staging a hybrid run (\`hybrid\` / \`hybrid <change>\`), both harnesses
     execute steps — check both harnesses' markers.
   - Before staging an auto run (\`auto\` / \`auto <change>\`), check only the
     current harness's markers, the same as default execution. Availability
     probing (executables, authentication, models, OMP isolation) is
     owned by the deterministic flow controller at \`spok flow next\` time;
     apply must not duplicate or front-run it.
   - If the harness(es) that will execute the flow are missing any marker,
     tell the user to run \`spok skills install --tools claude,codex\` (or just
     \`--tools claude\` / \`--tools codex\` for a single-harness default run) and
     STOP before staging.

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

   ## Commit Constraint
   Stage only the paths this chunk touches. Never embed a \`git status\`
   snapshot — it goes stale, and the commit step reads live status.

   ## Visual Evidence
   - Classification: <required | not-applicable>
   - Packet: spok/evidence/<change>/<chunk>/

   ## Body
   <indented chunk body from tasks.md, dedented>

   ## Change Context
   - Change root: <changeRoot>
   - Proposal: <changeRoot>/proposal.md
   - Specs: <changeRoot>/specs/
   - Design: <changeRoot>/design.md (if it exists)
   \`\`\`

   Replace \`<change>\` in the packet path with the selected change name and \`<chunk>\`
   with the parsed chunk slug. Keep the packet path repository-relative. Always write the
   section, including for legacy and \`not-applicable\` chunks.

   Pass the **absolute path** to that ticket directory forward.

6. **Invoke spok-flow**

   - For default execution, call the \`spok-flow\` skill with the absolute path to
     the staged ticket directory as the argument using the **Skill tool**.
   - For \`/spok-apply hybrid\`, call \`spok-flow\` with
     \`hybrid "<absolute-ticket-dir>"\` as its argument using the **Skill tool**.
   - For \`/spok-apply auto\`, call \`spok-flow\` with
     \`auto "<absolute-ticket-dir>"\` as its argument using the **Skill tool**.

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

   If \`spok/config.toml\` does not enable \`flow.self_learn = true\`, append:

   \`\`\`
   Optional: post-commit self-learn is off.
   Spok settings live in spok/config.toml. To enable it, add:

   [flow]
   self_learn = true

   See available settings with: spok capabilities --json
   \`\`\`

   If any chunk remains unchecked, STOP after showing progress. Publish only when
   the final chunk completes; continue to step 9 when 0 remain.

9. **Publish the completed change once**

   This step also handles an invocation where every chunk was already checked.
   Keep completed work complete while retrying publication.

   - Resolve the final listed chunk's slug from \`tasks.md\` and its absolute
     task directory \`<changeRoot>/.flow/<final-chunk-slug>/\`. Require its recorded
     flow state to exist before running \`spok flow status "<absolute-final-ticket-dir>" --json\`.
     Require \`state: "complete"\`, \`execution.workRoot\`, and \`execution.branch\`.
     Use these recorded values for every publication operation. Never infer a checkout or branch from the current directory.
     For a legacy completed change without execution context, STOP with an explicit
     unable-to-publish-safely error naming the missing record. Do not initialize a
     replacement flow, rerun completed work, or publish from a guessed repository.
   - Run every Git command with \`git -C <execution.workRoot>\`. Verify the recorded
     checkout exists, its current branch equals \`execution.branch\`, and its HEAD
     exactly equals the final flow's recorded commit (including a recorded no-op
     baseline commit). If HEAD differs, STOP and report both commits; do not publish
     unrelated later commits or reset the checkout. Resolve the target GitHub repository,
     push remote, head owner, and base branch from that checkout's Git remotes and
     GitHub repository metadata. If these are ambiguous or unavailable, STOP and
     report the missing context. Never switch branches or force-push to recover.
   - Use argument arrays for Git and GitHub CLI calls; if a shell is unavoidable,
     quote each argument safely. Treat change titles, paths, branch names, and
     artifact text as data, never shell code. Write the PR body as literal UTF-8
     to a temporary file and pass \`--body-file\`; never interpolate Markdown into
     a shell command or use command substitution to construct the body.
   - Query \`gh pr list\` with explicit \`--repo\`, \`--head <execution.branch>\`,
     \`--state all\`, and JSON fields including number, url, state, headRefName,
     headRepository, and headRepositoryOwner. Match the exact head repository,
     owner, and branch against the verified push destination. Account for pagination
     before concluding no match exists. Only a successful lookup with an empty result
     after exact matching permits creation. Authentication, network, and JSON errors
     must STOP publication; they never mean no matching PR. If multiple matches
     remain, report their URLs and STOP rather than choosing or creating another.
     Reuse an existing open PR. If a matching PR is closed or merged, return its URL
     and explain its state; do not push more work, reopen it, or create a duplicate.
   - Derive one change-level PR title and body from \`proposal.md\`, \`tasks.md\`, specs,
     and design when present. Verify actual commits and the full diff against the
     resolved PR base in the recorded checkout; cover every completed chunk, not
     only the final chunk's baseline. Include verification only when task artifacts
     record the exact commands and results. Do not invent passing checks.
   - Push the recorded branch to the verified remote with an explicit refspec and
     no force option. On success, use \`gh pr edit\` for the matching open PR or
     \`gh pr create\` only when lookup proved absence. Pass explicit \`--repo\`, title,
     and \`--body-file\`; creation also specifies the verified base and head.
     If creation fails or its outcome is uncertain, repeat the exact lookup before
     any create retry so a successful-but-unacknowledged request cannot duplicate a PR.
   - Read back the PR with explicit repository and number, verify its head matches
     the recorded branch and repository, and report its URL. Return the PR URL immediately
     after successful publication. Do not wait for human review. Never merge.
     Suggest \`/spok-archive\` only after publication succeeds.
   - On any publication failure, leave every completed checkbox checked, preserve
     the execution record, and report the failed operation and concrete remedy.
     Tell the user to retry \`/spok-apply <change>\` after fixing the blocker; this
     re-enters publication through the all-checked path. Do not rerun completed chunks or roll back commits.

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

export function getApplyCommandTemplate(): CommandTemplate {
  return {
    name: 'Spok: Apply',
    description: 'Ship the next chunk from tasks.md via spok-flow',
    category: 'Workflow',
    tags: ['workflow', 'apply'],
    content: APPLY_INSTRUCTIONS,
  };
}
