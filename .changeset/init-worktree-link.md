---
"spok": minor
---

### New Features

- **Worktree link registration** — `spok init` now registers the project's `spok/` directory in the enclosing checkout's `.worktreelink` and adds `.worktreelink` to the shared Git exclude file. Nested targets use a checkout-relative entry, updates append only when absent, and non-Git targets keep a project-local link file.
