---
"spok": major
---

### Breaking Changes

- **Focused workflow surface** — Spok now installs four user-facing skills: `/spok-explore`, `/spok-propose`, `/spok-apply`, and `/spok-archive`. Profiles, workflow selection, and the separate sync step are removed.
- **Retired upgrade artifacts** — Source, documentation, and upgrade cleanup no longer reference the pre-Spok action-based slash-command namespace.

### New Features

- **Deterministic chunk execution** — `spok flow status`, `spok flow next`, and `spok flow complete` own step order, resume state, and completion proof for each `/spok-apply` chunk.
- **Project diagnostics** — `spok/config.toml` is the canonical project config, existing YAML configs remain readable, and `spok doctor` reports actionable configuration errors.
- **Optional workflow learning** — Set `flow.self_learn = true` to run an advisory post-commit review and write `.flow/<chunk>/self-learn.md` after each shipped chunk.
- **Agent self-discovery** — `spok capabilities --json` exposes the supported CLI surface and configuration settings to agents and scripts.
- **Broad tool support** — `spok init` and `spok update` install the workflow and helper skills across more than 25 coding tools, including Kimi CLI.

### Improvements

- **Model-aware flow routing** — Flow roles select current Claude Opus or Codex GPT-5.6 models with explicit effort levels.
- **Vendored helper closure** — Initialization and updates install every helper skill needed by the four user-facing workflows.
- **Source installation guidance** — Installation and update instructions now match the source-based distribution used before the npm package is published.

### Bug Fixes

- **Canonical workspace paths** — Workspace planning remains stable across symlinks, Windows short paths, and equivalent path aliases.
- **Stable welcome screen** — Interactive terminals render one non-wrapping welcome frame when animation would exceed the available width.
