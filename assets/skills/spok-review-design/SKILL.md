---
name: spok-review-design
description: Review and reconcile a Spok task's design discussion and executable structure outline before implementation. Use when spok-flow dispatches design-review or an outline needs an independent readiness verdict.
---

# Review Design

Review the proposed design and implementation readiness after the structure outline exists.
Flows implement the reviewed outline directly; the CLI owns that sequence.
Resolve inconsistencies autonomously, preserve explicit user intent, and emit the
machine-readable verdict consumed by `spok flow complete`.

## Input

The argument is the absolute task directory:

`<task-dir>`

The directory already exists. Do not create it or search for another task directory.
Use the supplied execution work root when present for repository evidence. Keep task
artifacts at the supplied absolute task directory; never select a replacement work root.

## Artifact Authority

- Design discussion owns behavior, scope, APIs, UX, and tradeoffs.
- Structure outline owns executable phase decomposition, affected areas, interfaces,
  tests, and validation commands, and must conform to the design discussion.
- Design review owns the final reconciliation of those two artifacts, including evidence-backed decisions recorded in the design discussion.

A supplied answer is authoritative for the decision it answers. When a correction
asserts a fact about the codebase, do not accept it blindly: read the named files
and verify their paths, code, and commands. Record the evidence-backed resolution
in the design discussion before reconciling the outline.

Chronology does not determine authority. Never treat the newer outline as permission to
silently change a design decision.

## Review

1. Read these files fully:
   - `<task-dir>/ticket.md`
   - `<task-dir>/problem-validation.md` when present
   - `<task-dir>/research.md`
   - `<task-dir>/design-discussion.md`
   - `<task-dir>/structure-outline.md`
   Require `type: design-discussion` and `type: structure-outline` in those two
   artifacts' YAML frontmatter. A missing or mismatched type is a blocking finding;
   do not infer authority from the filename. This check applies before `PASS`.
2. Read repository files cited by those artifacts to verify factual claims, test patterns,
   interface ownership, and validation commands. Check exact command names and options
   against current scripts, configuration, or tool help in the repository work root.
   Distinguish evidence that a command exists from evidence that it ran and passed.
3. Review directly in this agent. Do not delegate the independent review.
4. Build a decision inventory from `design-discussion.md`: required behavior, scope,
   non-goals, APIs, UX, constraints, tradeoffs, and unresolved decisions.
5. Map required ticket behavior and resolved design decisions to outline phases and
   their tests or other verification. Compare every phase against that inventory and
   the cited evidence. Find:
   - behavior or scope added, removed, or changed by the outline
   - API, UX, or tradeoff decisions contradicted by the outline
   - required design behavior with no implementation phase
   - phase decomposition that cannot deliver the design
   - phases missing required behavior, completion conditions, affected areas,
     interface contracts or ownership where relevant, or independently executable verification
   - missing test coverage for required behavior and failure cases, or test locations,
     fixtures, and conventions that are not grounded in the actual repository
   - validation commands or options unsupported by repository scripts or tool evidence,
     missing working directories or expected outcomes, and unsubstantiated pass claims
   - implementation-critical detail deferred to a later plan
   - claims that conflict with repository evidence
   - a `### Scale` section that is missing, marked not applicable while the design
     touches persistent data, or claims 10×N without naming the mechanism
6. Resolve evidence-backed inconsistencies inside this stage:
   - Update `<task-dir>/design-discussion.md` first whenever evidence corrects or
     clarifies a design decision.
   - Record the rationale and evidence in the design discussion.
   - Only then reconcile `<task-dir>/structure-outline.md` with the revised design.
   - If the design is already correct, leave it unchanged and repair only the outline.
   - Fill readiness and coverage gaps when the resolved design and repository evidence
     determine the answer. Keep the outline concise; do not create a separate plan or
     expand it into line-by-line implementation instructions.
   - Resolve decisions autonomously using repository evidence and explicit user intent.
     Record the rationale for revising an earlier agent decision; do not override an
     explicit user requirement. There is no mandatory human signoff gate.
7. Re-read both artifacts after editing and repeat the consistency check.
8. When a consequential choice depends on unresolved user intent, use the supplied
   structured question packet protocol instead of guessing or introducing an approval gate.
   A question response ends with its NEEDS_INPUT marker and does not produce a completed
   review artifact. Consume durable answers on redispatch, then finish the review.
9. If a correction changes a visual target, rebuild and verify its evidence using the
   design skill's contract. Never claim human approval that was not supplied.

## Verdict

Return `PASS` only when:

- every consequential decision is resolved in `design-discussion.md`
- the outline conforms to the design discussion
- every required ticket behavior and resolved design decision maps to a viable phase
  and concrete verification
- each phase specifies required behavior, affected areas, relevant interface contracts
  and ownership, repository-grounded tests, and exact supported validation commands
  with working directories and expected outcomes
- phases are independently verifiable and executable without requiring a later plan
- no unresolved decision or required evidence gap remains

Return `FAIL` when a material design gap cannot be resolved or required evidence cannot
be obtained. A `FAIL` blocks progression. Do not use it as a routine human approval gate.
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

## Implementation Readiness

- <ticket and design coverage by phase and verification>
- <phase behavior, affected areas, interfaces, ownership, and repository-grounded tests>
- <exact validation commands and supporting script or tool evidence; distinguish unrun checks from observed results>

## Human Decisions Required

- <decision with concrete options and consequences, or "None.">
```

After writing, confirm the file exists and is non-empty with
`ls -la <task-dir>/design-review.md`. Return its absolute path.

## Handoff

- On `PASS`, return the artifact to the caller to complete the review step, then use
  `spok flow next "<task-dir>" --json` for the next stage. Flows implement the
  reviewed outline. Standalone, invoke `spok-implement-plan` with the task directory.
- On `FAIL`, stop and present `## Human Decisions Required`. Do not advance the flow.

## Guardrails

- Do not read, create, or edit `<task-dir>/plan.md`.
- Do not edit source code, tests, configuration, or task scope outside the two design artifacts.
- Do not implement the design.
- Do not change `ticket.md`, research artifacts, or explicit user requirements. Preserve any historical human approval as history, without treating it as a mandatory gate.
- Cite evidence for every autonomous correction.
