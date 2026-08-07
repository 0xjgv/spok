---
"spok": minor
---

### New Features

- **Worktree link registration** — `spok init` now registers `spok/` in the project's `.worktreelink` and adds `.worktreelink` to the repo's `.git/info/exclude`. Both steps append only when the line is absent, and the exclude step is skipped outside a git repo.
