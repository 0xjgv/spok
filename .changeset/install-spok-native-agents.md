---
"spok": minor
---

### New Features

- Install the 16 Spok-prefixed native agents alongside global skills for selected Claude Code and Codex hosts.
- Reconcile missing, outdated, and retired Spok-managed agents during global updates, with collision-safe `--force` adoption for exact catalog filenames.

### Improvements

- Route Spok workflows through the prefixed agent catalog using host-neutral foreground delegation.
- Warn during project init and update when selected Claude or Codex agents are missing without writing home-level files.
