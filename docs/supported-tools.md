---
version: 0.1.0
---

# Supported Tools

Spok works with many AI coding assistants. `spok init` configures the tools you select by installing the four user-facing skills (`spok-explore`, `spok-propose`, `spok-apply`, `spok-archive`) plus the vendored helper skill closure (`spok-flow`, `spok-create-scoped-chunks`, and the rest) under each tool's skills directory.

## How It Works

For each selected tool, Spok installs:

1. **User-facing skills**: `<tool-skills-dir>/skills/spok-explore/SKILL.md`, `spok-propose/SKILL.md`, `spok-apply/SKILL.md`, `spok-archive/SKILL.md`.
2. **Vendored helper skills**: `<tool-skills-dir>/skills/spok-flow/`, `spok-create-scoped-chunks/`, `spok-validate-problem/`, `spok-create-research-questions/`, `spok-create-research/`, `spok-create-design-discussion/`, `spok-create-structure-outline/`, `spok-review-design/`, `spok-create-plan/`, `spok-implement-plan/`, `spok-simplify/`, `spok-validate-implementation/`, `spok-repair/`, `spok-ci-commit/`, `spok-self-learn/`.

You invoke `/spok-explore`, `/spok-propose`, `/spok-apply`, and `/spok-archive` directly in your AI tool. The implementation skills delegate to the vendored helpers internally.

## Tool Directory Reference

| Tool (ID) | Skills path |
|-----------|-------------|
| Amazon Q Developer (`amazon-q`) | `.amazonq/skills/spok-*/SKILL.md` |
| Antigravity (`antigravity`) | `.agent/skills/spok-*/SKILL.md` |
| Auggie (`auggie`) | `.augment/skills/spok-*/SKILL.md` |
| IBM Bob Shell (`bob`) | `.bob/skills/spok-*/SKILL.md` |
| Claude Code (`claude`) | `.claude/skills/spok-*/SKILL.md` |
| Cline (`cline`) | `.cline/skills/spok-*/SKILL.md` |
| CodeBuddy (`codebuddy`) | `.codebuddy/skills/spok-*/SKILL.md` |
| Codex (`codex`) | `.agents/skills/spok-*/SKILL.md` |
| Continue (`continue`) | `.continue/skills/spok-*/SKILL.md` |
| CoStrict (`costrict`) | `.cospec/skills/spok-*/SKILL.md` |
| Crush (`crush`) | `.crush/skills/spok-*/SKILL.md` |
| Cursor (`cursor`) | `.cursor/skills/spok-*/SKILL.md` |
| Factory Droid (`factory`) | `.factory/skills/spok-*/SKILL.md` |
| Gemini CLI (`gemini`) | `.gemini/skills/spok-*/SKILL.md` |
| GitHub Copilot (`github-copilot`) | `.github/skills/spok-*/SKILL.md`\* |
| iFlow (`iflow`) | `.iflow/skills/spok-*/SKILL.md` |
| Junie (`junie`) | `.junie/skills/spok-*/SKILL.md` |
| Kilo Code (`kilocode`) | `.kilocode/skills/spok-*/SKILL.md` |
| Kimi CLI (`kimi`) | `.kimi/skills/spok-*/SKILL.md` |
| Kiro (`kiro`) | `.kiro/skills/spok-*/SKILL.md` |
| Lingma (`lingma`) | `.lingma/skills/spok-*/SKILL.md` |
| OpenCode (`opencode`) | `.opencode/skills/spok-*/SKILL.md` |
| Pi (`pi`) | `.pi/skills/spok-*/SKILL.md` |
| Qoder (`qoder`) | `.qoder/skills/spok-*/SKILL.md` |
| Qwen Code (`qwen`) | `.qwen/skills/spok-*/SKILL.md` |
| RooCode (`roocode`) | `.roo/skills/spok-*/SKILL.md` |
| Trae (`trae`) | `.trae/skills/spok-*/SKILL.md` |
| Windsurf (`windsurf`) | `.windsurf/skills/spok-*/SKILL.md` |

\* GitHub Copilot recognizes skill files as custom slash commands in IDE extensions (VS Code, JetBrains, Visual Studio). Copilot CLI does not currently consume project-level prompt files directly.

## Non-Interactive Setup

For CI or scripted setup, use `--tools`:

```bash
# Configure specific tools
spok init --tools claude,cursor

# Configure all supported tools
spok init --tools all

# Skip tool configuration
spok init --tools none
```

**Available tool IDs (`--tools`):** `amazon-q`, `antigravity`, `auggie`, `bob`, `claude`, `cline`, `codex`, `codebuddy`, `continue`, `costrict`, `crush`, `cursor`, `factory`, `gemini`, `github-copilot`, `iflow`, `junie`, `kilocode`, `kimi`, `kiro`, `opencode`, `pi`, `qoder`, `lingma`, `qwen`, `roocode`, `trae`, `windsurf`

## Global Skills

Install or refresh selected tools under your home directory with `spok skills install`:

```bash
spok skills install --tools claude,codex
```

Claude Code and Codex global installs include the same five Spok-prefixed native agents used by Spok workflows in addition to the skills:

| Selected tool | Global skills | Global native agents |
|---------------|---------------|----------------------|
| Claude Code (`claude`) | `~/.claude/skills/spok-*/SKILL.md` | `~/.claude/agents/spok-*.md` |
| Codex (`codex`) | `~/.agents/skills/spok-*/SKILL.md` | `~/.codex/agents/spok-*.toml` |

Agents are installed only for Claude Code and Codex when those tools are selected. Other selected tools receive skills only. The install summary reports the agent count for each selected native-agent tool.

After the initial installation, update every detected global Spok installation from any directory:

```bash
spok update --global
```

Global updates do not add tools and do not require a project `spok/` directory. They discover installations from Spok skills or Spok-managed agents, including agent-only installations. An update restores missing agents, refreshes outdated agents, and removes retired agents only when they carry Spok's managed marker. It preserves unprefixed files, unmarked files outside the current catalog, and other unrelated files.

Both global commands preflight exact agent catalog filenames before writing. Without `--force`, an exact-name collision with an unmarked user file aborts before any writes and reports the path and recovery command. `spok skills install --force` adopts and replaces only exact current catalog names. `spok update --global --force` refreshes every discovered skills installation and every exact managed or current catalog agent file, even when already current; unrelated files remain untouched.

Native-agent roots are fixed at `~/.claude/agents` and `~/.codex/agents`; alternate roots such as `CODEX_HOME` are not used. Neither command edits `~/.claude/settings.json` or `~/.codex/config.toml`.

Project-local `spok init` and `spok update` only warn when the selected Claude Code or Codex agents are missing or outdated. They never write home-scoped agents. Start a fresh Claude Code or Codex session after a global install or update so the new agents are loaded.

## Installed Skills

For every selected tool, Spok installs the same set of skill directories:

**User-facing (invoked via `/spok-*` slash commands):**

- `spok-explore`
- `spok-propose`
- `spok-apply`
- `spok-archive`

**Vendored helpers (invoked internally by the user-facing skills):**

- `spok-flow`
- `spok-create-scoped-chunks`
- `spok-validate-problem`
- `spok-create-research-questions`
- `spok-create-research`
- `spok-create-design-discussion`
- `spok-create-structure-outline`
- `spok-review-design`
- `spok-create-plan`
- `spok-implement-plan`
- `spok-simplify`
- `spok-validate-implementation`
- `spok-repair`
- `spok-ci-commit`
- `spok-self-learn`

The helper closure is refreshed by project-local `spok update` and home-scoped `spok update --global`, keeping each installation self-contained.

## Related

- [CLI Reference](cli.md) — Terminal commands
- [Commands](commands.md) — Slash command reference
- [Getting Started](getting-started.md) — First-time setup
