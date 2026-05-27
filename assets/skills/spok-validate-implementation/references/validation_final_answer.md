### Status

- Document: `<task-dir>/validation.md`
- Ticket: [ENG-XXXX](ticket URL if known, otherwise omit link)
- Verdict: [PASS or FAIL]
- Blocking Findings: [count or "none"]

### Summary

[2-3 sentence summary of the validation result]

### Key Findings

- [finding with file path, command result, or missing proof]
- [finding with file path, command result, or missing proof]

### Next Steps

If the verdict is `FAIL`, continue with a prompt like

```text
use the iterate-implementation skill for <task-dir>/plan.md and address the validation findings in <task-dir>/validation.md
```

If the verdict is `PASS`, continue with a prompt like

```text
use the describe-pr skill for <task-dir>
```
