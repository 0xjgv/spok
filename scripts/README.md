# Spok Scripts

Utility scripts for Spok maintenance and development.

## postinstall.js

Post-installation script that prints a one-line getting-started hint after
`bun install` / `npm install` of the published package. Skipped in CI and when
`SPOK_NO_INSTALL_TIP=1` is set.

## pack-version-check.mjs

Packs the project with `bun pm pack`, installs the tarball into a throwaway
project, and asserts that the installed CLI's `version` output matches
`package.json`. Used as a release-time guard.

## eval-flow-skills.mjs

Opt-in evaluation that runs the real composed `step.prompt` through a real model
against a real fixture repo. It exists to catch contradictions between skill
**prose** (`assets/skills/**/SKILL.md`) and the gates the CLI actually enforces —
a class of bug no deterministic test can see, because the test never reads the
prompt the way a model does.

The one scenario today, `commit-planning-state`, guards the incident where
`spok-ci-commit` told the agent never to commit paths under `spok/` while the
flow commit gate rejects the run with `Execution still has uncommitted chunk
changes` for exactly those paths. The fixture's chunk edits both `src/owned.ts`
and `spok/config.yaml`, so a rule that forbids one of them deadlocks.

The script seeds a temp git repo, drives the real CLI (`bin/spok.js`) step by
step to `commit` with minimal artifacts, then dispatches `step.prompt` to the
runner with the flags `assets/skills/spok-flow/SKILL.md` spells out. Afterwards
it asserts via Git that HEAD advanced by exactly one commit containing both chunk
paths, and that `spok flow complete --step commit` is not `blocked`. Skills are
vendored into the fixture by the CLI itself (`prepareExecution`), so the run
always exercises the current `assets/skills`, never a stale global copy.

```bash
bun run eval:skills -- --dry-run   # compose and print the prompt, call no model
bun run eval:skills -- --yes       # run the model (billed)
SPOK_EVAL=1 node scripts/eval-flow-skills.mjs --runner codex --keep
```

A model call costs money, so `--yes` or `SPOK_EVAL=1` is required; without it the
script prints the plan and exits 0. Other flags: `--runner claude|codex`,
`--model <id>` to override the routed model, `--keep` to retain the temp fixture.
Exits 1 on FAIL. Not part of `check` or `ci`.

Detection is sampled, not deterministic: with a contradictory rule injected into `spok-ci-commit`, the commit step's routed model refused in 1 of 3 runs and committed anyway in the other 2. Use `--samples N` (any failure fails the eval). The eval refuses to run when `~/.claude/skills` or `~/.agents/skills` drifts from `assets/skills`, because the host merges the global catalog and the stale copy wins; the child gets `--allowedTools 'Bash(git:*)'` because non-interactive `claude -p` cannot prompt.