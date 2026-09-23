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

Inside a flow run the CLI routes from here; the human invokes nothing. Standalone, stop after this report.

- `FAIL` with repair attempts remaining: the flow routes to a `repair` step and then back to `validate`. Name the blocking findings repair must address.
- `FAIL` with repair attempts exhausted: the flow blocks. Report the CLI reason exactly; do not edit `validation.md` to unblock it.
- `PASS`: the next step is `commit`, dispatched to `spok-ci-commit`.
