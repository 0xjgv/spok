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

Explore is a thinking-only mode for investigating ideas before a proposal. Propose creates a change with a chunked tasks list, apply ships one chunk end-to-end at a time, and archive folds your delta specs into the main specs. For smaller work, [Spok Lite](#spok-lite) replaces all four with `/spok-interview` and `/spok-execute`.

<p align="center">
  Follow <a href="https://x.com/0xjgv">@0xjgv on X</a> for updates.
</p>

## Install

Spok needs [Bun](https://bun.sh) 1.3.0 or newer. The installer is a POSIX shell
script for macOS, Linux, and WSL.

Install or update the latest release:

```sh
curl -fsSL https://raw.githubusercontent.com/0xjgv/spok/main/install.sh | sh
```

The installer downloads `spok-<version>.tgz` and `checksums.txt` from
[GitHub Releases](https://github.com/0xjgv/spok/releases), verifies the
archive's SHA-256, keeps it under `~/.local/share/spok/releases`, and installs
it with `bun add -g`. The `spok` command lands in Bun's global bin directory
(`bun pm bin -g`, usually `~/.bun/bin`); put that directory on your `PATH`.
Set `SPOK_VERSION` to pin a release:

```sh
curl -fsSL https://raw.githubusercontent.com/0xjgv/spok/main/install.sh | SPOK_VERSION=v1.4.1 sh
spok version
```

For a manual install, download the archive and `checksums.txt` from a release,
compare `shasum -a 256 spok-<version>.tgz` with its entry, then run
`bun add -g ./spok-<version>.tgz`. To uninstall, run `bun remove -g spok`.

To install from a source checkout, run `make install`. It builds the checkout,
packages it the same way a release does, and installs that package.

## Quick Start

Initialize Spok inside your project:

```bash
cd your-project
spok init
```

Now tell your AI coding assistant:

```text
/spok-propose <what-you-want-to-build>
```

Use `/spok-explore <topic>` first when you want to think through an idea before proposing work.

`spok init` configures your AI coding assistants, installs the four workflow skills (`spok-explore`, `spok-propose`, `spok-apply`, `spok-archive`) and the two Spok Lite skills (`spok-interview`, `spok-execute`), and vendors the helper skills they call (`spok-flow`, `spok-create-scoped-chunks`, and the rest of the closure).

### Spok Lite

For smaller work, skip the proposal and change folder. Spok Lite is two skills and one file:

```text
/spok-interview <topic>      # answer questions until a spec exists, then sign it off
/spok-execute <spec-title>   # in a fresh session: build the spec one slice at a time
```

`/spok-interview` asks questions until a fresh session could build without asking you anything. It writes `spok/specs/<spec-title>.md` with goal, numbered requirements, non-goals, constraints, acceptance checks, and an ordered `## Slices` checklist. Each slice is one user-visible outcome with its own check. Your sign-off on that spec is the only human gate.

`/spok-execute` hands each unchecked slice to a fresh subagent. The subagent finds the relevant code, writes a short plan, writes a failing test, implements the slice, runs the slice check and your project gate, and commits. The slice flips to `[x] (<sha>)`. After two failed fix attempts it flips to `[!]` with the exact error, and the loop stops. When every slice is done, it runs the spec's acceptance checks.

Use Spok Lite when you can approve the whole spec up front. Use `/spok-propose` and `/spok-apply` when the design needs review between research and implementation, or when you want delta specs and an archive. See [Workflows](docs/workflows.md#lite-path-interview-then-execute) for the comparison.

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
     [runs research -> cause check -> design -> outline -> implement -> simplify -> review -> commit]
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
│   └── <spec-title>.md     # Spok Lite spec with its slice checklist
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
- **Ship one chunk at a time** - `/spok-apply` runs a full research -> cause check -> design -> outline -> implement -> simplify -> review -> commit loop for one chunk, then stops.
- **Go light when it fits** - `/spok-interview` and `/spok-execute` turn one signed-off spec into one commit per slice.
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

## Updating Spok

Rerun the installer; it replaces the installed version and reports the change.

Then run this inside each project to refresh the installed skills:

```bash
spok update
```

## Usage Notes

**Model selection**: `spok flow` picks the model and effort for each step; `spok flow next` prints them. With Claude Code, every step runs on Opus (design at `xhigh` effort, review at `high`) and the commit on Sonnet. With Codex, steps run on GPT-6.1 Sol, the review on GPT-6 Astra, and the commit on GPT-6.1 Terra. `SPOK_FLOW_PROFILE=hybrid` runs research, implementation, review, and commit on Codex and the cause check, design, outline, and simplify on Claude.

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
- `make help` lists the release targets: `make install`, `make test`, `make check`, `make package`, `make release`
- Commit messages: short and imperative, one line ("Add verdict gate", not "feat: added verdict gates")

### Releases

Run `make release` from a clean `main` that is up to date with `origin`. It
takes the higher of the latest `vX.Y.Z` tag and the `package.json` version,
bumps the patch number (`make release BUMP=minor` or `BUMP=major` for the
others), commits the new `package.json` version as `chore(release): vX.Y.Z`,
tags it, and pushes `main` and the tag together. The tag starts the Release
workflow. It tests the tag, builds the package with `make package`,
smoke-tests `install.sh` against it, and publishes the GitHub release with
`spok-<version>.tgz`, `install.sh`, and `checksums.txt`.

Both halves are idempotent. When `HEAD` already carries a release tag,
`make release` only pushes that tag again. When the release already exists, the
workflow leaves it alone if every asset is present and otherwise re-uploads the
full set. To republish a tag by hand, run the Release workflow with that tag as
its input.

## Other

<details>
<summary><strong>Telemetry</strong></summary>

Spok collects anonymous usage stats.

We collect only command names and version to understand usage patterns. No arguments, paths, content, or PII. Automatically disabled in CI.

**Opt-out:** `export SPOK_TELEMETRY=0` or `export DO_NOT_TRACK=1`

</details>

## License

MIT
