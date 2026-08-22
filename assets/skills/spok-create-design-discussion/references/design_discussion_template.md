---
task: eng-xxxx-description
type: design-discussion
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

### Summary of change request

[summary of what the user wants to build based on their request and the ticket]

### Current State

- [what the user sees or experiences today — product behavior, UX gaps, user pain points — no file paths or function names]
- ..
- ..

### Desired End State

- [what will be true when this work is done]
- [user story, problems that will be solved, new things a user can do]
- ..

### What we're not doing

- [things that are out of scope]
- ..

### Current Architecture

- [technical codebase details — file paths with line numbers, function/type names, database columns, architecture facts]
- ..
- ..

### Scale

- Data touched: [table/collection/file, current N, expected growth]
- Access pattern: [lookup by X, scan, join, batch size]
- Stays fast at 10×N because: [index / pagination / streaming / bounded query]
- Not applicable because: [no persistent data or volume-bounded input]

[Fill exactly one of the last two lines. Name N; never write "fine" without the mechanism.]

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

### Design Questions

#### [title first question]

[the design question]

- Option A: ...
[optional: short code snippet]
- Option B: ...
[optional: short code snippet]
- ..

Reccomendation: [....]

#### [title second design question]

...


### Resolved Design Questions

#### [title resolved question]

[option chosen] - [rationale] - [patternt to follow]


#### [ title second resolved question]

...
