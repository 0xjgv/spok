---
"spok": minor
---

### New Features

- Add a design-review gate to `spok-flow`: after the structure outline, the flow dispatches the `spok-review-design` skill to reconcile the design discussion against the outline and record a PASS/FAIL verdict before planning starts.
- Teach `spok-apply`'s preflight to verify the `spok-review-design` skill closure for default (native) runs, not only hybrid runs.

### Bug Fixes

- Guard against malformed design-review verdicts: an unreadable or drifted FAIL block now still surfaces its `## Human Decisions Required` section to the human instead of being silently dropped.
