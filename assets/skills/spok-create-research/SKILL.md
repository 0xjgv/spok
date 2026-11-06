---
name: spok-create-research
description: Research the codebase from supplied research questions and write an evidence-based research document.
argument-hint: <research-questions-file> (absolute path to <task-dir>/research-questions.md)
license: MIT
metadata:
  author: spok
  version: "1.1"
---

# Research Codebase

Your only job is to document and explain the codebase as it exists today. This is read-only research: do not change source code, diagnose root causes, critique the implementation, recommend changes, or propose future work unless the user explicitly requests it.

When a question asks which paths write or derive a state, document every such path and the trace each leaves in stored data (fields, flags, values), so a later step can tell the paths apart with one query or repro. Describe the paths; do not pick the one that caused a reported defect.

## Invocation contract

- The skill argument is the absolute path to `<task-dir>/research-questions.md`.
- Read the supplied `<task-dir>/research-questions.md` immediately and fully before response/planning/delegation. Use a full-file read with no offset or limit.
- Derive `<task-dir>` from that file's parent directory. Do not create or search for the directory.
- Never read `<task-dir>/ticket.md`. Do not infer ticket intent from its filename or contents. Use ticket metadata only when it is supplied in the user context; otherwise omit it.
- Write exactly one research artifact at `<task-dir>/research.md`. Use `{SKILLBASE}/references/research_template.md` as its structure and `{SKILLBASE}/references/research_final_answer.md` for the final response contract.

## Workflow

1. Read the supplied research questions as required above. Identify the concrete questions, named areas, and any directly mentioned non-ticket files. Read each such file fully before planning or delegation.
2. Make a short research plan that separates independent codebase areas. Group related questions that touch the same area into one focused, read-only subagent prompt; delegate only when it adds coverage or speed, and aim for 2-6 well-scoped subagents rather than one per question. Delegate through the current host's native subagent mechanism: `spok-codebase-locator` first to find what exists, then `spok-codebase-analyzer` or `spok-codebase-pattern-finder` on the promising findings. Give each subagent a bounded question and require local `path:line` evidence; do not prescribe how to search, each agent already knows its job. Wait for every subagent before synthesis.
3. Investigate and synthesize from the live codebase. Treat source and tests as the primary evidence. Cite every factual finding with a local `path:line` reference. Add external links only when the user explicitly asks for them.
4. Gather the repository, branch, commit, and timestamp values required by the research template. Before writing, delete any sibling file matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-research.md` from legacy runs. Write a self-contained technical narrative to `<task-dir>/research.md`, then confirm the file exists and is non-empty. Do not alter unrelated files.
5. Read the final-answer template and reply with the artifact's absolute path, a concise evidence-based summary, key local references, open-question status, and the template's next-phase prompt.

## Research document requirements

- Use takeaway-first headers: each section title states the conclusion, followed by the evidence and explanation. Number the top-level findings sections. A reader skimming the headers alone should come away with how the system works.
  - BAD (topic label): `### Session storage`
  - BAD (question as header): `### How does the daemon persist sessions?`
  - GOOD (takeaway): `### Sessions persist to Postgres before the daemon acks the write`
- Cite every factual finding. Cite local files as `path/to/file.ts:42`; citations must resolve in the current checkout. Do not rely on uncited summaries from subagents.
- Cite concept-first, not location-first: name what the code does, then where it lives. Use a line range when adjacent lines carry the same fact.
  - BAD: `src/app.ts:57` creates WorkosService, then `src/app.ts:58` creates S3Service
  - GOOD: Services are module-level singletons created at startup (`src/app.ts:57-80`): WorkosService, S3Service, and two database handles.
- Explain component connections where evidence supports them. Use a diagram only when relationships among three or more components are materially clearer than concise prose; otherwise use prose or a small list.
- Include a `Testing patterns` subsection for every researched component area. State the current unit, integration, acceptance, or end-to-end patterns with test locations and what each pattern exercises. If no test evidence is found, say that explicitly with the searched-area evidence.
- Keep the document factual and self-contained. Describe what exists, where it exists, how it works, and how parts interact. Do not turn unknowns into recommendations.
- Put genuine unresolved facts under `Open Questions`. Do not ask why an unbuilt feature is missing or what should be built next.

## Views

Reach for the view that shows structure faster than prose does. Put it beside the prose it illustrates and keep it objective: current state only, never a `diff` block or `+`/`-` markers.

- Call-stack tree for how control flows today: the important calls only, one call per line, indented by call depth.
- File tree for how responsibility splits across files, drawn with `├──`, `└──`, and `│` glyphs, each entry annotated with what it owns.
- Type-signature, endpoint, or data-contract block for a boundary as it exists: `PUT /api/sessions/:id` with its request and response shapes.
- Pseudocode for logic too complex for a sentence and not worth reproducing in full — english-y, not a programming language.
- Diagrams stay under the gate in the section above.

## Follow-up research

- At most one targeted follow-up pass is allowed when a specific unresolved fact blocks a complete answer. Scope it to that fact and use the same evidence standard.
- After the pass, repaint the affected sections of `research.md` so the document is coherent. Never append a follow-up transcript, timestamped follow-up section, or frontmatter update trail.
- If the fact remains unresolved after that pass, leave it under `Open Questions` and finalize.

## Guardrails

- Do not read ticket files, including through a subagent prompt or an indirect command.
- Do not use placeholder values in the artifact.
- Do not make claims based on conventions, filenames, or assumptions without code or test evidence.
- External research and links are out of scope unless the user explicitly asks for them.

## Markdown formatting

When writing markdown that contains a code block showing Markdown, use four backticks for the outer fence so an inner three-backtick block cannot close it early.
