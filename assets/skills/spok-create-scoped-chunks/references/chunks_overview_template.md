---
parent_task: <parent-slug>
type: chunks-overview
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# <Parent Task Title> — Chunk Plan

[2-3 sentence summary of the parent task and the slicing strategy]

## Parent task

See [parent-task.md](./parent-task.md) for the original description.

## Chunks

| # | Slug | User-observable behavior | Layers | Prereqs |
|---|------|--------------------------|--------|---------|
| 01 | `<chunk-slug>` | … | db, be, fe | none |
| 02 | `<chunk-slug>` | … | be, fe | 01 |

## Dependency graph

```
01 ──► 02 ──► 04
       └────► 03
```

## Suggested order

1. `<parent-slug>-01-<chunk-slug>`
2. `<parent-slug>-02-<chunk-slug>`
3. …

## Invocations

Run each chunk through `hl-commit-agents`:

```text
use the hl-commit-agents skill for .humanlayer/tasks/<parent-slug>-01-<chunk-slug>
```

```text
use the hl-commit-agents skill for .humanlayer/tasks/<parent-slug>-02-<chunk-slug>
```

## Out of scope

- [items deliberately excluded from this slicing]
