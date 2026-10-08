### Status

- Document: `<task-dir>/structure-outline.md`
- Ticket: [ENG-XXXX](ticket URL if known, otherwise omit link)
- Phases: [count]
- Open Questions: [count or "none"]

### Phase Summary

1. [Phase 1 title]: [brief description]
2. [Phase 2 title]: [brief description]
...

### Open Questions (if any)

- [question 1]
- ...

### Next Steps

Inside a flow, return the outline to the caller. The caller completes the step and
uses `spok flow next "<task-dir>" --json` to select the next stage. Design review
checks whether the outline is ready for implementation.

Standalone, request a readiness review:

```text
use the spok-review-design skill for <task-dir>
```

After a passing review, use `spok-implement-plan` with the task directory.
