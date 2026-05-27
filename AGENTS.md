# CLAUDE

## Commands

- After edits: `bun run check` — fix lint, build, typecheck, test, hook-drift + suppression report
- Pre-commit: `bun run pre-commit` — staged files only (auto via git hook)
- CI: `bun run ci` — read-only pipeline: lint → typecheck → build → audit → complexity → acceptance → coverage → crap → arch. CRAP is advisory (warns only — pass `--enforce` to hard-fail). Requires `uvx` on PATH.
- Complexity: `bun run harness.ts complexity` — lizard@1.22.2 CC gate (CCN≤15, args≤7, length≤100) over src + test
- Audit: `bun run audit` — audit dependencies for known vulnerabilities (via bun audit)
- Acceptance: `bun run acceptance` — run cucumber against `test/features/`
- Coverage: `bun run coverage --min=0` — vitest coverage (LCOV) with threshold
- CRAP (advisory): `bun run crap --max=30` — complexity × coverage gate. Add `--enforce` to exit 1 on offenders (default exits 0 with warning).
- Arch: `bun run arch` — dependency-cruiser against `.dependency-cruiser.json`
- Agents drift: `bun run harness.ts agents-md-drift` — fail if AGENTS.md differs from CLAUDE.md
- Sync: `bun run harness.ts sync-agents-md` — overwrite AGENTS.md from CLAUDE.md
- Setup: `bun run setup-hooks` to install git pre-commit hook
- Auto-format: runs automatically after Claude edits via `Stop` hook (post-edit eslint --fix)

## Behavior contract

<important if="you accept a new task">
- Restate the task as at most 5 sub-tasks. Each sub-task MUST touch ≤1 non-test file and ≤1 test.
- If the task cannot be decomposed within that bound, STOP and return a decomposition proposal. Do NOT edit code in the same turn.
- If a proposed sub-task would edit more than one non-test file, split it further before writing code.
- **Exception — uniform mechanical edits**: a single change pattern (same edit, same shape) applied across N sibling files counts as 1 sub-task, not N. State the pattern, list the files, and proceed. Example: "Prepend `version: 0.1.0` frontmatter to 13 docs/*.md files."
</important>

<important>
## Role

- The human is the engineer. They own design, API shape, and merge authority. You propose, they dispose.
- Do NOT run `git commit`, `git push`, or equivalent publishing commands unless the user's current prompt asked for it. The verbs `commit`, `push`, `ship`, `land`, `merge` in action context authorize that turn only.
- If you decide on your own to "commit this and move on," the `PreToolUse` hook will deny the command. That is working as intended.
</important>

<important if="the task changes user-visible behavior">
- Workflow: write or extend a `.feature` scenario → get human approval → write step definitions → write implementation.
- Refactors, typo fixes, dependency bumps, and internal cleanup are NOT user-visible behavior changes. You MAY proceed without a new `.feature`, but you MUST state in your first response that the change is non-behavioral and why.
- If it is unclear whether a task changes user-visible behavior, ASK before editing source.
</important>

<important if="you want to edit `.dependency-cruiser.json` (arch config)">
- Do not silently edit the arch config to silence a violation. Architectural violations imply a design decision — surface them to the human.
- The `PreToolUse` hook denies edits to `.dependency-cruiser.json` unless the user's current prompt explicitly authorized it.
</important>
