---
"spok": minor
---

### Improvements

- **Flow steps are told which repository contains the implementation** — `spok flow complete --step implement` accepts a new `--work-root <absolute-path>` flag, recorded in `workflow-state.json` and threaded into later simplify, repair, and commit prompts. The commit subagent no longer rediscovers the repository with a bare `git status` in whatever directory it inherits, which previously let it report "no changes" against the wrong repo or commit an unrelated session's work.
- **Recorded commit SHAs are verified** — when a work root is recorded, `--commit` must name a commit object reachable from `HEAD` in that repository; a wrong-repo or hallucinated SHA blocks instead of being recorded. Workflow states written without a work root keep the previous behavior and surface a `workRootWarning`.
- **`spok-ci-commit` is grounded in artifacts, not session history** — the skill derives its file list from the task directory's plan and validation artifacts, confirms it against `git -C <work-root> status`, stages exactly that intersection, and fails loudly on an empty or mismatched set rather than falling back to a directory scan.
