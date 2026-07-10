---
version: 0.1.0
---
<p align="center">
  <a href="https://github.com/0xjgv/spok">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/spok_pixel_dark.svg">
      <img src="assets/spok_pixel_light.svg" alt="Spok logo" width="180">
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/0xjgv/spok/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/0xjgv/spok/actions/workflows/ci.yml/badge.svg" /></a>
  <!-- <a href="https://www.npmjs.com/package/spok"><img alt="npm version" src="https://img.shields.io/npm/v/spok?style=flat-square" /></a> -->
  <a href="./LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" /></a>
</p>

**Lightweight spec-driven development for AI coding agents.** Spok helps you and your agent agree on what to build, ship one thin slice at a time, and fold the final behavior back into living specs.

Spok is built around four workflow skills you give your AI coding assistant:

```text
/spok-explore  ->  /spok-propose  ->  /spok-apply  ->  /spok-archive
```

That's the whole surface. Explore is a thinking-only mode for investigating ideas before a proposal. Propose creates a change with a chunked tasks list, apply ships one chunk end-to-end at a time, and archive folds your delta specs into the main specs.

<p align="center">
  Follow <a href="https://x.com/0xjgv">@0xjgv on X</a> for updates.
</p>

## Quick Start

**Requires [Bun](https://bun.sh) 1.3.0 or higher.**

The npm package has not been published. Install Spok from source:

```bash
mkdir -p "$HOME/.local/share"
git clone https://github.com/0xjgv/spok.git "$HOME/.local/share/spok"
cd "$HOME/.local/share/spok"
bun install
bun run build
mkdir -p "$HOME/.bun/bin"
ln -sf "$PWD/bin/spok.js" "$HOME/.bun/bin/spok"
spok version
```

Keep the source checkout at `$HOME/.local/share/spok`; the global `spok` command links to it.

Then initialize Spok inside your project:

```bash
cd your-project
spok init
```

Now tell your AI coding assistant:

```text
/spok-propose <what-you-want-to-build>
```

Use `/spok-explore <topic>` first when you want to think through an idea before proposing work.

`spok init` configures your AI coding assistants, installs the four workflow skills (`spok-explore`, `spok-propose`, `spok-apply`, `spok-archive`), and vendors the helper skills they call (`spok-flow`, `spok-create-scoped-chunks`, and the rest of the closure).

> [!NOTE]
> Not sure if your tool is supported? [View the full list](docs/supported-tools.md). Spok supports 25+ tools and growing.

## See It In Action

```text
You: /spok-explore should we add dark mode?
AI:  Investigates the existing UI and summarizes options without changing files.

You: /spok-propose add-dark-mode
AI:  Created spok/changes/add-dark-mode/
     + proposal.md - why we're doing this, what's changing
     + specs/       - requirements and scenarios
     + design.md    - technical approach
     + tasks.md     - chunked checklist (3 chunks)
     Run /spok-apply to ship the first chunk.

You: /spok-apply
AI:  Shipping chunk 1: Add theme context + CSS variables
     [runs research -> design -> plan -> implement -> review -> commit]
     + Chunk shipped. 2/3 remaining.

You: /spok-apply
AI:  Shipping chunk 2: Wire toggle component to localStorage
     + Chunk shipped. 1/3 remaining.

You: /spok-apply
AI:  Shipping chunk 3: Apply theme to remaining surfaces
     + Chunk shipped. 0/3 remaining. Run /spok-archive.

You: /spok-archive
AI:  Applied delta specs to spok/specs/ui/spec.md
     Archived to spok/changes/archive/2026-05-26-add-dark-mode/
```

## What Spok Creates

Spok keeps planning artifacts next to your code:

```text
spok/
├── specs/                  # Source-of-truth behavior specs
├── changes/
│   └── add-dark-mode/
│       ├── proposal.md     # Intent, scope, and approach
│       ├── specs/          # Delta specs for this change
│       ├── design.md       # Technical design
│       └── tasks.md        # Chunked implementation checklist
└── config.toml             # Optional project config
```

Each change is isolated until you archive it. During archive, Spok applies the delta specs to `spok/specs/` and moves the completed change into history.

## Why Spok?

AI coding assistants are powerful, but they get unpredictable when requirements live only in chat history. Spok adds a lightweight spec layer so the human and agent agree before implementation starts.

- **Agree before you build** - capture intent, requirements, and design before code changes.
- **Stay organized** - keep every proposed change in its own folder with specs, design, and tasks.
- **Explore before proposing** - use `/spok-explore` as a thinking-only mode when the direction is still unclear.
- **Ship one chunk at a time** - `/spok-apply` runs a full research -> design -> plan -> implement -> review -> commit loop for one chunk, then stops.
- **Use your tools** - Spok works with 25+ AI coding tools and does not lock you into one IDE or model.

## Docs

- **[Getting Started](docs/getting-started.md)**: first steps
- **[Workflows](docs/workflows.md)**: combos and patterns
- **[Commands](docs/commands.md)**: slash commands & skills
- **[CLI](docs/cli.md)**: terminal reference
- **[Supported Tools](docs/supported-tools.md)**: tool integrations & install paths
- **[Concepts](docs/concepts.md)**: how it all fits
- **[Multi-Language](docs/multi-language.md)**: multi-language support
- **[Migration Guide](docs/migration-guide.md)**: upgrading from older Spok versions

## Philosophy

```text
-> fluid, not rigid
-> iterative, not waterfall
-> easy, not complex
-> built for brownfield, not just greenfield
-> scalable from personal projects to enterprises
```

### How we compare

**vs. [Spec Kit](https://github.com/github/spec-kit)** (GitHub) - Thorough but heavyweight. Rigid phase gates, lots of Markdown, Python setup. Spok is lighter and lets you iterate freely.

**vs. [Kiro](https://kiro.dev)** (AWS) - Powerful but you're locked into their IDE and limited to Claude models. Spok works with the tools you already use.

**vs. nothing** - AI coding without specs means vague prompts and unpredictable results. Spok brings predictability without the ceremony.

## Updating Spok

Pull and rebuild the source checkout:

```bash
cd "$HOME/.local/share/spok"
git pull --ff-only
bun install
bun run build
```

Refresh agent instructions:

Run this inside each project to regenerate AI guidance and ensure the latest skills are active:

```bash
spok update
```

## Usage Notes

**Model selection**: Spok works best with high-reasoning models. We recommend Codex 5.5 and Opus 4.7 for both planning and implementation.

**Context hygiene**: Spok benefits from a clean context window. Clear your context before starting implementation and maintain good context hygiene throughout your session.

## Contributing

**Small fixes** - Bug fixes, typo corrections, and minor improvements can be submitted directly as PRs.

**Larger changes** - For new features, significant refactors, or architectural changes, please submit a Spok change proposal first so we can align on intent and goals before implementation begins.

When writing proposals, keep the Spok philosophy in mind: we serve a wide variety of users across different coding agents, models, and use cases. Changes should work well for everyone.

**AI-generated code is welcome** - as long as it's been tested and verified. PRs containing AI-generated code should mention the coding agent and model used (e.g., "Generated with Claude Code using claude-opus-4-5-20251101").

### Development

- Install dependencies: `bun install`
- Build: `bun run build`
- Test: `bun run test`
- Develop CLI locally: `bun run dev` or `bun run dev:cli`
- Point global `spok` at this checkout: `ln -sf "$PWD/bin/spok.js" ~/.bun/bin/spok`
- Keep the linked CLI current while editing: run `bun run dev` in one terminal, then use `spok ...` in another
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
