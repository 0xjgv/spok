---
version: 0.1.0
---

# Installation

## Prerequisites

- **Bun 1.3.0 or higher** — Check your version: `bun --version`. Install via [bun.sh](https://bun.sh).

## Install

```bash
bun add -g spok
```

## Verify Installation

```bash
spok version
```

## Recommended Global Setup (Optional)

Install Spok skills for the supported tools you use:

```bash
spok skills install --tools claude,codex
```

Spok writes skills only to the selected supported tools. When Claude Code or Codex is selected, it also installs the same five `spok-*` native agents used by Spok workflows in that tool's canonical home path: skills under `~/.claude/skills` and `~/.agents/skills`, and agents under `~/.claude/agents` and `~/.codex/agents`.

Start a fresh Claude Code or Codex session after a global install or update so it discovers the installed agents. See [Supported Tools](supported-tools.md) for collision, `--force`, and reconciliation details.

## Next Steps

Initialize Spok in your project:

```bash
cd your-project
spok init
```

`spok init` remains project-local. It does not install global agents; it only warns when the selected tool is missing them.

See [Getting Started](getting-started.md) for a full walkthrough.
