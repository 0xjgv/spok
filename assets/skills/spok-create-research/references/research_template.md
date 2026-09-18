---
date: [Current date and time with timezone in ISO format]
git_commit: [Current commit hash]
branch: [Current branch name]
repository: [Repository name]
topic: "[User's Question/Topic]"
type: research
tags: [research, codebase, relevant-component-names]
status: complete
---

# Research: [User's Question/Topic]

**Date**: [Current date and time with timezone from step 4]
**Git Commit**: [Current commit hash from step 4]
**Branch**: [Current branch name from step 4]
**Repository**: [Repository name]

## Research Question
[Original user query]

## Research Methodology (verbatim)

This document will remain objective and factual. It does not contain any recommendations or implementation suggestions.
Open questions will not ask Why things haven't been built or what should be built in the future.

There is no "implementation" section - that is intentional.

## Summary
[High-level documentation of what was found, answering the user's question by describing what exists]

## Detailed Findings

[Organize by concept, not by file location. Number the top-level sections. Write each one as a
cohesive explanation with citations woven in, not a file index and not a list of answers to the
research questions. Describe current state only: never use `diff` blocks or `+`/`-` change markers.]

### 1. [Takeaway about this concept — the header asserts what's true, not the topic or the question]

[Cohesive explanation of what exists, how it works, and how it connects to other components, with
citations woven in and adjacent lines ranged — e.g. (`path/to/file.ts:57-80`). Place each view
beside the prose it illustrates: call-stack tree, file tree, type-signature or endpoint contract
block, or pseudocode.]

#### Testing patterns
- [concrete examples of how this component is tested in the codebase]
- [unit or integration or e2e or whatever else exists]

### 2. [Takeaway about the next concept]
...

## Code References

[Group by area. For each group, state whether the list is exhaustive for that area or covers the key
files while others in the directory may also be relevant.]

- `path/to/file.py:123` - Description of what's there (exhaustive for this module)
- `another/file.ts:45-67` - Description of the code block
- `path/to/directory/` - Description of directory contents (key files listed; others exist)

## Architecture Documentation
[Current patterns, conventions, and design implementations found in the codebase]

## Open Questions
[Any areas that need further investigation - keep it focused to codebase understanding - "How does X Work" not "Should Y be the case"]
