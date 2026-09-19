---
task: eng-xxxx-description
type: structure-outline
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# [Plan Title]

[2-3 sentence plan summary]

## Current State

- [current state of codebase relevant to this change]
- ...

## Desired End State

- [what will be true when this is done]
- ...

## Implementation Overview

- [ ] Phase 1: [Phase Title]
- [ ] Phase 2: [Phase Title]
- [ ] ...

## What we're not doing

- [things that are out of scope]
- ...

### Patterns to follow

#### [title First pattern from research]

[summary of the pattern] - e.g. [path/to/file]

```
[succint code examples demonstrating the pattern]
```

```
[succint code examples demonstrating the pattern]
```

#### [title Second pattern from the research]

...

### Design Summary

Full discussion doc: `<task-dir>/design-discussion.md`

#### [decision 1, e.g. use x column on y table]

[deciscion, rationale, code snippets]

#### [decision 2]

...

---

## Phase 1: [Phase Title]

[Overview of what this phase accomplishes]

Implements: [resolved decision title(s) from `design-discussion.md` that this phase delivers]

### Change Outline

[Tell the story of this phase in the order that makes it easiest to understand. Prose first. It may make sense to show files first, or to establish a data structure, SQL table, or API contract first. Every view below is optional - keep only the ones that explain this phase, and order them from the change rather than from this template. Write it as one human writes to another. Use `diff` for a focused change to an existing shape. Show the complete target shape in a language-specific or `text` block when it is new, high-level, or clearer without diff notation. Follow the show-me guidance the skill read.]

{...short-description...}

```diff
 path/to/shared/root/
 ├── existing-area/
 │   ├── existing-file.ts
+│   │   ~ [high-level behavior or code shape that changes]
+│   └── new-module.ts          + owns the new behavior
 └── other-area/
-    ├── removed-file.ts
+    └── changed-file.ts        ~ short ownership or behavior note
```

[Keep a file tree high-level and easy to scan. Use proper tree glyphs (`├──`, `└──`, and `│`), not ASCII substitutes. Start added and changed (`~`) lines with `+`, removed lines with `-`, and unchanged context lines with a space. Show methods, fields, components, or data flow beneath a file only when they clarify the change.]

{...short-description...}

```ts
type RecordStatus = 'draft' | 'active' | 'archived'

interface RecordSummary {
  id: string
  status: RecordStatus
}
```

{...short-description - key data structure, SQL table, or API contract when it explains the rest of the phase...}

```diff
 records
   id                 uuid primary key
+  status             text not null       + new lifecycle state
+  organization_id    uuid not null       ~ included in the lookup index
-  legacy_flag        boolean
```

{...short-description...}

```diff
 PATCH /records/:id
 request
   id: string
+  status: RecordStatus
 response
   record: Record
+    status: RecordStatus
```

[optional - show new or changed signatures rather than whole bodies, use ... verbatim in body]

```diff
 async function [name](
   [arg1],
+  [arg3],
-  [arg2],
 ): [returntype] { ... }
```

### Validation

#### Automated Verification

- [ ] [runnable command taken from the repository manifest or `research.md`]
- [ ] ...

#### Manual Verification

- [ ] [step that needs human judgment - omit this subsection when the phase has none]
- [ ] ...

---

## Phase 2: [Phase Title]

...

---

## Open Questions

- [questions about plan structure that need clarification]
- ...
