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

Full discussion doc: [YYYY-MM-DD-design-discussion.md](use cloud permalink from Read hook additionalContext)

#### [decision 1, e.g. use x column on y table]

[deciscion, rationale, code snippets]

#### [decision 2]

...

---

## Phase 1: [Phase Title]

[Overview of what this phase accomplishes]

### File Changes

- **`path/to/file.ts`**: [what changes in this file]
- **`path/to/file.ts`**: [what changes in this file]


[optional - show new method signatures or changes, use ... verbatim in body]
```typescript
async function [name]([args]): [returntype] { ... }
````

- **`path/to/file.ts`**: [what changes in this file]

[optional - show new method signatures or changes, use ... verbatim in body]
```diff
 async function [name](
   [arg1],
+  [arg3],
-  [arg2],
 ): [returntype] { ... }
````

### Validation

[How we'll know it's working as intended - what part of the vertical slice will be testable]

---

## Phase 2: [Phase Title]

...

---

## Open Questions

- [questions about plan structure that need clarification]
- ...
