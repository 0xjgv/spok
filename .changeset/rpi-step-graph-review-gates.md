---
"spok": minor
---

Realign the Spok flow with HumanLayer's RPI workflow: the CLI step graph is now research questions → research → design discussion → outline → implement → commit, and the user reviews after every phase before the flow advances.

Problem validation, design review, simplify, validate, repair, and self-learn are removed from the flow. Saved flows that still contain a removed step are rejected with a request to start a new task directory; finished legacy flows still report completion so they can be published.
