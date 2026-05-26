### Status

- Document: [.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-validation.md](cloud permalink from hook)
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
use the rpi:iterate-implementation skill for [.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-plan.md] and address the validation findings in [.humanlayer/tasks/ENG-XXXX-description/YYYY-MM-DD-validation.md]
```

If the verdict is `PASS`, continue with a prompt like

```text
use the rpi:describe-pr skill for .humanlayer/tasks/ENG-XXXX-description
```

---

You can view the full document here: [YYYY-MM-DD-validation.md](cloud permalink from hook)
