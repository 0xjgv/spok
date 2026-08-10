---
name: spok-create-research
description: Research the codebase from supplied research questions and write an evidence-based research document.
---

# Research Codebase

Your only job is to document and explain the codebase as it exists today. This is read-only research: do not change source code, diagnose root causes, critique the implementation, recommend changes, or propose future work unless the user explicitly requests it.

## Invocation contract

- The skill argument is the absolute path to `<task-dir>/research-questions.md`.
- Read the supplied `<task-dir>/research-questions.md` immediately and fully before response/planning/delegation. Use a full-file read with no offset or limit.
- Derive `<task-dir>` from that file's parent directory. Do not create or search for the directory.
- Never read `<task-dir>/ticket.md`. Do not infer ticket intent from its filename or contents. Use ticket metadata only when it is supplied in the user context; otherwise omit it.
- Write exactly one research artifact at `<task-dir>/research.md`. Use `{SKILLBASE}/references/research_template.md` as its structure and `{SKILLBASE}/references/research_final_answer.md` for the final response contract.

## Workflow

1. Read the supplied research questions as required above. Identify the concrete questions, named areas, and any directly mentioned non-ticket files. Read each such file fully before planning or delegation.
2. Make a short research plan that separates independent codebase areas. Use focused, read-only subagents only when they add coverage or speed: locate relevant files first, then analyze or compare established patterns. Give each subagent a bounded question and require local `path:line` evidence. Wait for every subagent before synthesis.
3. Investigate and synthesize from the live codebase. Treat source and tests as the primary evidence. Cite every factual finding with a local `path:line` reference. Add external links only when the user explicitly asks for them.
4. Gather the repository, branch, commit, and timestamp values required by the research template. Before writing, delete any sibling file matching `<task-dir>/[0-9]{4}-[0-9]{2}-[0-9]{2}-research.md` from legacy runs. Write a self-contained technical narrative to `<task-dir>/research.md`, then confirm the file exists and is non-empty. Do not alter unrelated files.
5. Read the final-answer template and reply with the artifact's absolute path, a concise evidence-based summary, key local references, open-question status, and the template's next-phase prompt.

## Research document requirements

- Use takeaway-first headers: each section title states the conclusion, followed by the evidence and explanation.
- Cite every factual finding. Cite local files as `path/to/file.ts:42`; citations must resolve in the current checkout. Do not rely on uncited summaries from subagents.
- Explain component connections where evidence supports them. Use a diagram only when relationships among three or more components are materially clearer than concise prose; otherwise use prose or a small list.
- Include a `Testing patterns` subsection for every researched component area. State the current unit, integration, acceptance, or end-to-end patterns with test locations and what each pattern exercises. If no test evidence is found, say that explicitly with the searched-area evidence.
- Keep the document factual and self-contained. Describe what exists, where it exists, how it works, and how parts interact. Do not turn unknowns into recommendations.
- Put genuine unresolved facts under `Open Questions`. Do not ask why an unbuilt feature is missing or what should be built next.

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
