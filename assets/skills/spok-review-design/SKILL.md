---
name: spok-review-design
description: Review and reconcile a Spok task's design discussion and structure outline before plan creation. Use when spok-flow dispatches the design-review step for a task directory or when a completed structure outline needs an independent design-readiness verdict.
---

# Review Design

Review the proposed design after the structure outline exists and before planning begins.
Resolve inconsistencies autonomously, preserve explicit user intent, and emit the
machine-readable verdict consumed by `spok flow complete`.

## Input

The argument is the absolute task directory:

`<task-dir>`

The directory already exists. Do not create it or search for another task directory.

## Artifact Authority

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns phase decomposition and must conform to the design discussion.
- Design review owns the final reconciliation of those two artifacts, including evidence-backed decisions recorded in the design discussion.
- The later plan may add step-level implementation detail only. It cannot override the reviewed design.

Chronology does not determine authority. Never treat the newer outline as permission to
silently change a design decision.

## Review

1. Read these files fully:
   - `<task-dir>/ticket.md`
   - `<task-dir>/problem-validation.md` when present
   - `<task-dir>/research-questions.md`
   - `<task-dir>/research.md`
   - `<task-dir>/design-discussion.md`
   - `<task-dir>/structure-outline.md`
2. Read repository files cited by those artifacts when needed to verify a factual claim.
3. Review directly in this agent. Do not delegate the independent review.
4. Build a decision inventory from `design-discussion.md`: required behavior, scope,
   non-goals, APIs, UX, constraints, tradeoffs, and unresolved decisions.
5. Compare every outline phase against that inventory and the cited evidence. Find:
   - behavior or scope added, removed, or changed by the outline
   - API, UX, or tradeoff decisions contradicted by the outline
   - required design behavior with no implementation phase
   - phase decomposition that cannot deliver the design
   - claims that conflict with repository evidence
   - a `### Scale` section that is missing, marked not applicable while the design
     touches persistent data, or claims 10×N without naming the mechanism
6. Resolve evidence-backed inconsistencies inside this stage:
   - Update `<task-dir>/design-discussion.md` first whenever evidence corrects or
     clarifies a design decision.
   - Record the rationale and evidence in the design discussion.
   - Only then reconcile `<task-dir>/structure-outline.md` with the revised design.
   - If the design is already correct, leave it unchanged and repair only the outline.
   - Resolve decisions autonomously using repository evidence and explicit user intent.
     Record the rationale for revising an earlier agent decision; do not override an
     explicit user requirement. There is no mandatory human signoff gate.
7. Re-read both artifacts after editing and repeat the consistency check.
8. Ask questions when useful through the supplied structured question packet protocol.
   A question response ends with its NEEDS_INPUT marker and does not produce a completed
   review artifact. Consume durable answers on redispatch, then finish the review.
9. If a correction changes a visual target, rebuild and verify its evidence using the
   design skill's contract. Never claim human approval that was not supplied.

## Verdict

Return `PASS` only when:

- every consequential decision is resolved in `design-discussion.md`
- the outline conforms to the design discussion
- every required behavior has a viable phase
- no unresolved decision or required evidence gap remains

Return `FAIL` when a material design gap cannot be resolved or required evidence cannot
be obtained. A `FAIL` blocks planning. Do not use it as a routine human approval gate.
Questions chosen by the agent use the structured question packet before a final verdict.

## Output

Write `<task-dir>/design-review.md`. Before writing, delete any sibling file matching
`<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-design-review.md` from legacy runs.

The file must begin with one of these exact frontmatter blocks:

```yaml
---
type: design-review
verdict: PASS
---
```

```yaml
---
type: design-review
verdict: FAIL
---
```

Do not reorder, quote, rename, or add other frontmatter fields.

Use this body shape:

```markdown
# Design Review

## Artifacts Reviewed

- <artifact and relevant evidence>

## Revisions Applied

- <design-discussion change followed by outline reconciliation, or "None.">

## Consistency Check

- <behavior, scope, API, UX, tradeoff, and phase-decomposition result>

## Human Decisions Required

- <decision with concrete options and consequences, or "None.">
```

After writing, confirm the file exists and is non-empty with
`ls -la <task-dir>/design-review.md`. Return its absolute path.

## Handoff

- On `PASS`, tell the caller to use `spok-create-plan` with `<task-dir>`.
- On `FAIL`, stop and present `## Human Decisions Required`. Do not start planning.

## Guardrails

- Do not read, create, or edit `<task-dir>/plan.md`.
- Do not edit source code, tests, configuration, or task scope outside the two design artifacts.
- Do not implement the design.
- Do not change `ticket.md`, research artifacts, or explicit user requirements. Preserve any historical human approval as history, without treating it as a mandatory gate.
- Cite evidence for every autonomous correction.
