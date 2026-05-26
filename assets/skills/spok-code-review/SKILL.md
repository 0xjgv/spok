---
name: spok-code-review
description: Run a code review at the requested rigor. Vendored stub — relies on the user-installed code-review tooling. Argument: rigor level (e.g., "high").
license: MIT
metadata:
  author: spok
  version: "1.0"
---

# spok-code-review

This is a vendored placeholder. The original `code-review` skill ships with
the user's Claude Code installation (e.g. the `code-review` plugin from the
official marketplace). When invoked by `spok-flow`, run a code review on the
current branch's changes at the rigor level passed as the argument.

Output: a review summary listing any blocking issues, suggested fixes, and a
verdict (approve / request-changes).
