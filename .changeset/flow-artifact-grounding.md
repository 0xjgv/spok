---
"spok": minor
---

### New Features

- **Visual evidence workflow contract** — `/spok-apply` stages a `## Visual Evidence` section on every ticket, carrying a `required` / `not-applicable` classification and an evidence packet path under `spok/evidence/<change>/<chunk>/`.
- **Self-learn loop closure** — the advisory post-commit review writes its findings back through `spok/MEMORY.md`, so repository rules composed into each step prompt carry what previous chunks learned.

### Improvements

- **Validation verdicts gate the commit** — `spok flow complete --step validate` reads the recorded verdict from `validation.md`. A `PASS` advances the flow; a `FAIL` or unreadable verdict returns `state: "blocked"` and never hands the agent `commit`.
- **Grounded artifact claims** — workflow skills no longer let an unverified repository fact propagate downstream:
  - `spok-create-research-questions` requires one mandatory question every run, asking for the repository's actual lint, typecheck, test, and format commands sourced from `package.json` / `Makefile` / equivalent manifest, never inferred from a toolchain name.
  - `spok-create-plan` requires automated-verification commands to come from the manifest or from `research.md`, and to say so plainly when research did not establish them rather than hedging.
  - `spok-implement-plan` reports only checks it actually executed, naming the exact command and its real output, and discloses a plan-named command this repository does not have instead of substituting one silently.
  - `spok-flow` does not relay into `flow complete --summary` a verification claim that cannot be attributed to a command that ran.
  - `spok-ci-commit` never stages a path the agent did not modify and never treats a gitignored path as committable.
  - The `/spok-apply` ticket template states a `## Commit Constraint` rule — stage only the paths this chunk touches, never embed a `git status` snapshot.
- **Lower Fable workflow effort** — Fable-routed flow steps run at a reduced reasoning effort.
