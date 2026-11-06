---
name: spok-cause-check
description: Tell the credible causes of a reported wrong state apart with one discriminating observation before design, and write evidence/causal-paths.md with the first-wrong-step trace. Records N/A for new behavior. Invoked by spok-flow between research and design-discussion.
argument-hint: <task-dir> (absolute task directory containing ticket.md and research.md)
license: MIT
metadata:
  author: spok
  version: "1.0"
---
# Tell the Causes Apart

Design places a fix where the evidence locates the cause. This step gets that
evidence. Done when `<task-dir>/evidence/causal-paths.md` exists, is non-empty,
and your reply returns its absolute path.

## Inputs

- The argument is the absolute path to the task directory. It already exists;
  do not create or search for it.
- Read `<task-dir>/ticket.md` and `<task-dir>/research.md` fully, without
  offset or limit. Read the ticket's `## Claims` section: an `observed` claim
  names its source; a `hypothesis` is a suspected cause nobody has checked.
  Treat every hypothesis as unproven, even when the ticket states it as fact.
- Do not read `<task-dir>/research-questions.md`; research supersedes it.
- When the flow prompt supplies a work root, run every repository read, query,
  and repro from there.

## Steps

1. **Decide whether a defect is reported.** For new behavior with no reported
   wrong state, write `N/A: no defect` as the whole note body (under the
   frontmatter below), confirm the file, and return its path. Skip the rest.

2. **List the causal paths.** From the research, list each path that could
   produce the reported state: what it writes, what it predicts in stored data
   (fields, flags, values), and the cheapest observation that rules it out.
   List at least two when more than one is still credible. Do not invent
   alternatives to reach two.

3. **Get the discriminating observation before design.** Use a bounded query on
   real data, or a repro that runs from the writer to the reader.
   - A test that injects the final bad state cannot tell writers apart. Do not
     count one as the observation.
   - A query on production data goes to the user to run: state the exact query,
     what each path predicts it returns, and ask for the result. Never run it
     yourself.
   - Delegate code tracing to `spok-codebase-analyzer` or
     `spok-codebase-locator` when it adds speed; verify their `path:line`
     claims before relying on them.

4. **Trace the supported path to its first wrong step.** For the path the
   observation supports, trace reader → stored value → writer → the writer's
   input. Mark each link `checked on real data`, `replayed`, or `read in code`.
   The first wrong step is the first link whose input is correct and whose
   output is wrong.

5. **When no observation is possible before design**, ask the user to choose:
   **Get the evidence first (Recommended)** or **Design without it**. State in
   the consequence that designing without it means the fix location may be
   wrong. Record the question, the answer, and that consequence in the note.

## Asking the user

Never ask the user directly inside the flow. When running under `spok flow`,
raise it through the flow's question packet: follow the prompt's packet path,
schema, and final `NEEDS_INPUT` line, and do not write the note in that
dispatch. On redispatch, read the injected answers (a production query result
or the evidence choice) and finish the note. Otherwise use AskUserQuestion.

For the evidence choice, use a `choice` question with the two options above,
`recommendedOptionId` set to the evidence-first option, and each option's
`consequence` ending `Rests on: <weakest premise> (verified|unverified)`.

## Output

Create `<task-dir>/evidence/` when needed and write
`<task-dir>/evidence/causal-paths.md`:

```markdown
---
type: causal-paths
---

# Causal Paths

## Reported State
<the observed wrong state, with its source from the ticket's Claims>

## Paths
### <path name>
- Writes: <what it writes, path:line>
- Predicts in stored data: <fields, flags, values>
- Ruled out by: <cheapest observation>

## Observation
- Ran: <exact query or repro, and who ran it>
- Result: <what came back>
- Limits: <what it cannot tell apart>
- Supports: <path name, or "no single path">

## First Wrong Step
1. Reader: <path:line> — <checked on real data | replayed | read in code>
2. Stored value: <field/value> — <mark>
3. Writer: <path:line> — <mark>
4. Writer input: <value> — <mark>

First wrong step: <the first link whose input is correct and whose output is wrong>

## Evidence Choice
<only when no observation was possible: the question, the answer, and that the fix location may be wrong>
```

Rules:

- Cite every code claim with `path:line` that resolves in the work root.
- Keep the note factual. Do not propose the fix; design owns that.
- If the observation supports no single path, say so under `Supports` and in
  `First Wrong Step`. Never name a location as right whichever path caused it.
- After writing, run `ls -la <task-dir>/evidence/causal-paths.md`. If it is
  missing or empty, write it again.
- Do not edit source files, other task artifacts, or git state.

Return the absolute path of `<task-dir>/evidence/causal-paths.md`, the path the
observation supports (or `N/A: no defect`), and the first wrong step.
