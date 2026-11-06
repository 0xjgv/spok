---
"spok": minor
---

Align the Spok flow with RPI 0.10.0. The step graph is research questions → research → cause check → design discussion → structure outline → implement → simplify → correctness review → commit. The design discussion is the only human gate; every other phase advances on completion. The correctness review must record `verdict: PASS` in `review.md` before the commit, and simplify and review may not change paths outside the implementation allowlist. Step routing follows RPI's models and efforts (opus stages, sonnet commit; GPT-6.1 Sol/Terra and GPT-6 Astra for Codex). Finished flows load read-only.

Spok now ships only the skills it runs: new `spok-cause-check`, `spok-review-correctness`, `spok-interview`, and `spok-execute`; retired `spok-review-design`, `spok-self-learn`, `spok-validate-implementation`, and `spok-validate-problem` are removed from installed catalogs. Execution worktrees receive only the five execution-step skills.
