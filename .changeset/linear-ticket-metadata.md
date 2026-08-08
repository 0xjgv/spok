---
"spok": minor
---

### New Features

- Add optional ticket metadata to changes and surface it in `spok list` table and JSON output.
- Teach `spok-propose` to use connected Linear MCP tools for Linear issue references.

### Bug Fixes

- Skip worktree-link registration when discovered Git metadata is empty or invalid.
- Prevent ticket metadata from emitting terminal control sequences in table and JSON list output.
