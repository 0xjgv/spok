---
version: 0.1.0
---

<p align="center">
  <a href="https://github.com/Fission-AI/Spok">
    <picture>
      <source srcset="assets/spok_bg.png">
      <img src="assets/spok_bg.png" alt="Spok logo">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/Fission-AI/Spok/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Fission-AI/Spok/actions/workflows/ci.yml/badge.svg" /></a>
  <a href="https://www.npmjs.com/package/spok"><img alt="npm version" src="https://img.shields.io/npm/v/spok?style=flat-square" /></a>
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
  <a href="https://discord.gg/YctCnvvshC"><img alt="Discord" src="https://img.shields.io/discord/1411657095639601154?style=flat-square&logo=discord&logoColor=white&label=Discord&suffix=%20online" /></a>
</p>

<details>
<summary><strong>The most loved spec framework.</strong></summary>

[![Stars](https://img.shields.io/github/stars/Fission-AI/Spok?style=flat-square&label=Stars)](https://github.com/Fission-AI/Spok/stargazers)
[![Downloads](https://img.shields.io/npm/dm/spok?style=flat-square&label=Downloads/mo)](https://www.npmjs.com/package/spok)
[![Contributors](https://img.shields.io/github/contributors/Fission-AI/Spok?style=flat-square&label=Contributors)](https://github.com/Fission-AI/Spok/graphs/contributors)

</details>
<p></p>
Our philosophy:

```text
→ fluid not rigid
→ iterative not waterfall
→ easy not complex
→ built for brownfield not just greenfield
→ scalable from personal projects to enterprises
```

Spok is built around three slash commands you give your AI coding assistant:

```text
/spok-propose  →  /spok-apply  →  /spok-archive
```

That's the whole surface. Propose creates a change with a chunked tasks list, apply ships one chunk end-to-end at a time, archive folds your delta specs into the main specs and moves the change into history.

<p align="center">
  Follow <a href="https://x.com/0xTab">@0xTab on X</a> for updates · Join the <a href="https://discord.gg/YctCnvvshC">Spok Discord</a> for help and questions.
</p>

## See it in action

```text
You: /spok-propose add-dark-mode
AI:  Created spok/changes/add-dark-mode/
     ✓ proposal.md — why we're doing this, what's changing
     ✓ specs/       — requirements and scenarios
     ✓ design.md    — technical approach
     ✓ tasks.md     — chunked checklist (3 chunks)
     Run /spok-apply to ship the first chunk.

You: /spok-apply
AI:  Shipping chunk 1: Add theme context + CSS variables
     [runs research → design → plan → implement → review → commit]
     ✓ Chunk shipped. 2/3 remaining.

You: /spok-apply
AI:  Shipping chunk 2: Wire toggle component to localStorage
     ✓ Chunk shipped. 1/3 remaining.

You: /spok-apply
AI:  Shipping chunk 3: Apply theme to remaining surfaces
     ✓ Chunk shipped. 0/3 remaining. Run /spok-archive.

You: /spok-archive
AI:  Applied delta specs to spok/specs/ui/spec.md
     Archived to spok/changes/archive/2026-05-26-add-dark-mode/
```

<details>
<summary><strong>Spok Dashboard</strong></summary>

<p align="center">
  <img src="assets/spok_dashboard.png" alt="Spok dashboard preview" width="90%">
</p>

</details>

## Quick Start

**Requires [Bun](https://bun.sh) 1.3.0 or higher.**

Install Spok globally:

```bash
bun add -g spok@latest
```

Then navigate to your project directory and initialize:

```bash
cd your-project
spok init
```

Now tell your AI: `/spok-propose <what-you-want-to-build>`.

`spok init` configures your AI coding assistants (Claude Code, Cursor, Windsurf, and others), installs the three workflow skills (`spok-propose`, `spok-apply`, `spok-archive`), and vendors the helper skills they call (`spok-flow`, `spok-create-scoped-chunks`, and the rest of the closure).

> [!NOTE]
> Not sure if your tool is supported? [View the full list](docs/supported-tools.md) – we support 25+ tools and growing.
>
> [See installation options](docs/installation.md).

## Docs

→ **[Getting Started](docs/getting-started.md)**: first steps<br>
→ **[Workflows](docs/workflows.md)**: combos and patterns<br>
→ **[Commands](docs/commands.md)**: slash commands & skills<br>
→ **[CLI](docs/cli.md)**: terminal reference<br>
→ **[Supported Tools](docs/supported-tools.md)**: tool integrations & install paths<br>
→ **[Concepts](docs/concepts.md)**: how it all fits<br>
→ **[Multi-Language](docs/multi-language.md)**: multi-language support<br>
→ **[Migration Guide](docs/migration-guide.md)**: upgrading from older Spok versions


## Why Spok?

AI coding assistants are powerful but unpredictable when requirements live only in chat history. Spok adds a lightweight spec layer so you agree on what to build before any code is written.

- **Agree before you build** — human and AI align on specs before code gets written
- **Stay organized** — each change gets its own folder with proposal, specs, design, and a chunked tasks list
- **Ship one chunk at a time** — `/spok-apply` runs a full research → design → plan → implement → review → commit loop for one chunk, then stops
- **Use your tools** — works with 20+ AI assistants

### How we compare

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) — Thorough but heavyweight. Rigid phase gates, lots of Markdown, Python setup. Spok is lighter and lets you iterate freely.

**vs. [Kiro](https://kiro.dev)** (AWS) — Powerful but you're locked into their IDE and limited to Claude models. Spok works with the tools you already use.

**vs. nothing** — AI coding without specs means vague prompts and unpredictable results. Spok brings predictability without the ceremony.

## Updating Spok

**Upgrade the package**

```bash
bun add -g spok@latest
```

**Refresh agent instructions**

Run this inside each project to regenerate AI guidance and ensure the latest skills are active:

```bash
spok update
```

## Usage Notes

**Model selection**: Spok works best with high-reasoning models. We recommend Codex 5.5 and Opus 4.7 for both planning and implementation.

**Context hygiene**: Spok benefits from a clean context window. Clear your context before starting implementation and maintain good context hygiene throughout your session.

## Contributing

**Small fixes** — Bug fixes, typo corrections, and minor improvements can be submitted directly as PRs.

**Larger changes** — For new features, significant refactors, or architectural changes, please submit a Spok change proposal first so we can align on intent and goals before implementation begins.

When writing proposals, keep the Spok philosophy in mind: we serve a wide variety of users across different coding agents, models, and use cases. Changes should work well for everyone.

**AI-generated code is welcome** — as long as it's been tested and verified. PRs containing AI-generated code should mention the coding agent and model used (e.g., "Generated with Claude Code using claude-opus-4-5-20251101").

### Development

- Install dependencies: `bun install`
- Build: `bun run build`
- Test: `bun run test`
- Develop CLI locally: `bun run dev` or `bun run dev:cli`
- Conventional commits (one-line): `type(scope): subject`

## Other

<details>
<summary><strong>Telemetry</strong></summary>

Spok collects anonymous usage stats.

We collect only command names and version to understand usage patterns. No arguments, paths, content, or PII. Automatically disabled in CI.

**Opt-out:** `export SPOK_TELEMETRY=0` or `export DO_NOT_TRACK=1`

</details>

<details>
<summary><strong>Maintainers & Advisors</strong></summary>

See [MAINTAINERS.md](MAINTAINERS.md) for the list of core maintainers and advisors who help guide the project.

</details>



## License

MIT
