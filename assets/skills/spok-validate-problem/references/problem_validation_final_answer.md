### Status

- Document: `<task-dir>/problem-validation.md`
- Ticket: [ENG-XXXX](ticket URL if known, otherwise omit link)
- Verdict: `CONFIRMED` | `NOT-REPRODUCIBLE` | `INCONCLUSIVE` | `N/A`
- Task type: `bug` | `regression` | `performance` | `feature-greenfield` | `chore`

### Evidence

- [the failing command and raw output, measured number, error log, or exact repro steps]
- Baseline (performance only): [value, method, and commit]
- If `N/A`: one line explaining that there is no existing behavior to validate.
- If `NOT-REPRODUCIBLE` or `INCONCLUSIVE`: what was tried and why it fell short.

### Flow Decision

[proceed -> research questions | pending user decision | halted and asked the user, decision was X]

### Next Step

To continue this session, use a prompt like the below:

```text
use the spok-create-research-questions skill with the ticket at <task-dir>/ticket.md
(problem-validation evidence: <task-dir>/problem-validation.md)
```
