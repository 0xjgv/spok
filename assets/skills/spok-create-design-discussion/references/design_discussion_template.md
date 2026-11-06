---
task: eng-xxxx-description
type: design-discussion
repo: [current repository]
branch: [current branch name]
sha: [result of git rev-parse HEAD]
---

# Design Discussion

## Context

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

## Proposed End State Architecture

[concise outline of the proposed end state with description, diagrams, pseudocode, or `diff` blocks according to the visual guidance]

## Smallest Viable Control

- Fix location: [the first wrong step from `evidence/causal-paths.md`, or `N/A: no defect`; steps below it get at most a guard]
- Existing mechanisms: [relevant controls, state, platform or upstream guarantees, with evidence]
- Smallest viable scope: [the bounded change and why it meets the behavior contract]
- Alternatives compared: [reuse existing mechanisms versus adding a control; rejected tradeoffs]
- Added cost: [justify added state, flags, or cross-service controls by the failure existing mechanisms cannot prevent, or state that none is needed]
- Reopens if: [the observation that would move the decision]

## Design Questions

[Every consequential question the user has not answered. Never resolve one yourself. Write `None.` once the user has answered all of them.]

### [question title]

[the design question, and the observation that would change the pick]

- Option A: [choice] — [consequence]. Rests on: [weakest premise] (verified|unverified)
  [optional: short code snippet, diagram, or pseudocode]
- Option B: [choice] — [consequence]. Rests on: [weakest premise] (verified|unverified)
- ..

Recommendation: [option and why, grounded in codebase conventions]

[For a defect: give options at the writer, a shared boundary, and the reader; name the consumers each leaves wrong. Never recommend a location "whichever path" caused it.]

## Resolved Design Questions

[Empty in a new document. Only the user's answers move a question here.]

### [question title]

- Decision: [the option the user chose]
- Rationale: [why this option fits the request, the evidence, and existing patterns; the user answer it follows]
- Options not chosen: [each option and the brief reason it was discarded]
- Boundaries and assumptions: [what this decision excludes and any remaining uncertainty]

## System Design

- Components and boundaries: [which components change and why]
- Contracts and data flow: [cross-component interfaces, compatibility, and failure behavior]
- Unchanged boundaries: [where existing mechanisms remain sufficient]

## Program Design

- In-code shape: [modules, functions, types, and responsibilities grounded in research]
- Patterns reused: [existing implementation patterns and locations]
- Verification approach: [behavior to verify and established testing patterns]

## Visual Evidence

- Classification: [required or not-applicable, from the ticket]
- Result: [for not-applicable, explain that no packet is needed; for required, record verified status]
- Packet: [for required, repository-relative path and relative Markdown link to index.html]
- Design decision: [for required, the target choice, rationale, and the user answers it follows]
- Verification: [for required, states and viewports rendered and inspected, plus results]
