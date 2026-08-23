Feature: Tool skill artifacts
  Spok installs workflow skills without creating slash-command wrapper files.

  Scenario: Claude and Codex setup creates only Claude and Agents skills
    Given a new project
    When I initialize Spok for the tools "claude,codex"
    Then Spok creates skills under ".claude/skills"
    And Spok creates the workflow skill "spok-explore" under ".claude/skills"
    And Spok creates the workflow skill "spok-validate-problem" under ".claude/skills"
    And Spok creates the workflow skill "spok-self-learn" under ".claude/skills"
    And Spok creates skills under ".agents/skills"
    And Spok creates the workflow skill "spok-explore" under ".agents/skills"
    And Spok creates the workflow skill "spok-validate-problem" under ".agents/skills"
    And Spok creates the workflow skill "spok-self-learn" under ".agents/skills"
    And Spok does not create ".claude/commands"
    And Spok does not create ".codex"
    And Spok does not create command or prompt files for the selected tools

  Scenario: Claude and Codex update creates missing explore skills
    Given a new project
    And an existing Spok setup for the tools "claude,codex" without the workflow skill "spok-explore"
    When I update Spok with force
    Then Spok creates the workflow skill "spok-explore" under ".claude/skills"
    And Spok creates the workflow skill "spok-explore" under ".agents/skills"
    And Spok does not create command or prompt files for the selected tools

  Scenario: Update removes retired Spok command artifacts
    Given a new project
    And retired Spok command artifacts exist
    When I update Spok with force
    Then Spok removes the retired command artifacts

  Scenario: Setup guidance presents explore before proposing a change
    Given a new project
    When I initialize Spok for the tools "claude"
    Then setup guidance mentions "/spok-explore"
    And setup guidance mentions "/spok-propose"
    And Spok creates file "spok/config.toml"

  Scenario: Init registers a nested Spok project for worktrees
    Given a new project
    And the project is a Git repository
    When I initialize Spok for the tools "claude" in "packages/app"
    And I initialize Spok for the tools "claude" in "packages/app"
    Then the repository worktree link contains one "packages/app/spok/" entry
    And the repository excludes ".worktreelink"

  Scenario Outline: Init skips worktree registration for invalid Git metadata
    Given a new project
    And the project has <invalid_metadata>
    When I initialize Spok for the tools "claude" in "packages/app"
    Then Spok does not create ".worktreelink"
    And Spok does not create "packages/app/.worktreelink"

    Examples:
      | invalid_metadata                |
      | invalid Git metadata            |
      | an empty Git metadata directory |

  Scenario: Init preserves backslashes in POSIX project directory names
    Given a new project
    And the project is a Git repository
    And the platform permits backslashes in directory names
    When I initialize Spok for the tools "claude" in "packages/app\\alias"
    Then the repository worktree link contains one "packages/app\\alias/spok/" entry

  Scenario: CLI warns about invalid project config and points to doctor
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"

      [flow]
      self_learn = "yes"
      """
    When I run the Spok CLI in the project with "list"
    Then the Spok CLI exits with code 0
    And the Spok CLI error contains "Warning: invalid Spok config at spok/config.toml"
    And the Spok CLI error contains "Run `spok doctor` for a full configuration report."

  Scenario: JSON commands are not polluted by config warnings
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"

      [flow]
      self_learn = "yes"
      """
    When I run the Spok CLI in the project with "list --json"
    Then the Spok CLI exits with code 0
    And the Spok CLI output is valid JSON
    And the Spok CLI error does not contain "invalid Spok config"

  Scenario: Instructions reject schema templates outside their templates directory
    Given a new project
    And a project schema template points outside its templates directory
    When I run the Spok CLI in the project with "instructions proposal --change demo --schema escaping --json"
    Then the Spok CLI output does not contain "outside-template-secret"
    And the Spok CLI exits with code 1
    And the Spok CLI error contains "Template path must stay within the schema templates directory"

  Scenario: Doctor reports invalid project config
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"

      [flow]
      self_learn = "yes"
      """
    When I run the Spok CLI in the project with "doctor"
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "Spok Doctor"
    And the Spok CLI output contains "Config: spok/config.toml"
    And the Spok CLI output contains "flow.self_learn must be boolean"

  Scenario: Doctor reports missing project config schema
    Given a new project
    And project config contains:
      """
      [flow]
      self_learn = true
      """
    When I run the Spok CLI in the project with "doctor"
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "schema is required"

  Scenario: Apply delegates inner flow sequencing to deterministic flow commands
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-flow" under ".claude/skills" mentions "spok flow next"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "spok flow complete"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "host-owned `general-purpose`"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "model: <step.model>"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "effort: <step.effort>"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "spok flow next --json is the source of truth"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "Spok settings live in spok/config.toml. To enable it, add:"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "See available settings with: spok capabilities --json"

  Scenario: Flow relays design-review human decisions on FAIL and unreadable verdicts
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-flow" under ".claude/skills" mentions "Step design-review recorded a FAIL verdict"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "Step design-review has no readable verdict"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "## Human Decisions Required"

  Scenario: Design review makes the discussion the final design authority
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-review-design" under ".claude/skills" mentions "Design discussion owns behavior, scope, APIs, UX, and tradeoffs."
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "Update `<task-dir>/design-discussion.md` first"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "then reconcile `<task-dir>/structure-outline.md`"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "type: design-review"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "verdict: PASS"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "verdict: FAIL"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "## Human Decisions Required"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "Do not read, create, or edit `<task-dir>/plan.md`"
    And the workflow skill "spok-review-design" under ".claude/skills" mentions "spok-create-plan"

  Scenario: Apply exposes a hybrid Claude and Codex execution mode
    Given a new project
    When I initialize Spok for the tools "claude,codex"
    Then the workflow skill "spok-apply" under ".claude/skills" mentions "/spok-apply hybrid"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "hybrid <change>"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "SPOK_FLOW_PROFILE=hybrid"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "codex exec"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "--dangerously-bypass-hook-trust"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "claude -p"

  Scenario: Hybrid apply preflights both harness skill closures
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-apply" under ".claude/skills" mentions "Before staging a hybrid run"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "~/.claude/skills/spok-flow/SKILL.md"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "~/.agents/skills/spok-flow/SKILL.md"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "~/.claude/skills/spok-review-design/SKILL.md"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "~/.agents/skills/spok-review-design/SKILL.md"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "spok skills install --tools claude,codex"

  Scenario: Default apply preflights the current tool's skill closure
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-apply" under ".claude/skills" mentions "Default execution"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "check only that harness's markers."
    And the workflow skill "spok-apply" under ".claude/skills" mentions "check both harnesses' markers."

  Scenario: Inner flow implementation overrides standalone orchestration
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-implement-plan" under ".claude/skills" mentions "override every conflicting instruction anywhere in this skill"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "In inner spok-flow mode, resume directly"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "Outside inner spok-flow mode, delegate each phase to a separate"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "Inside inner spok-flow mode, do not commit"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "In inner spok-flow mode, implement and verify directly."

  Scenario: Visual chunks preserve a browser-review design contract
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-scoped-chunks" under ".claude/skills" mentions "**Visual evidence:** required | not-applicable"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "## Visual Evidence"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "spok/evidence/<change>/<chunk>/"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "open the generated `index.html`"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Print the absolute path"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "status back to `pending`"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "explicit human approval"
    And the workflow skill resource "references/design_evidence_template.html" under "spok-create-design-discussion" in ".claude/skills" contains "Current"
    And the workflow skill resource "references/design_evidence_template.html" under "spok-create-design-discussion" in ".claude/skills" contains "Target"

  Scenario: Proposal interviews only for consequential missing intent
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-propose" under ".claude/skills" mentions "Assess the request before creating the change directory or any planning artifact."
    And the workflow skill "spok-propose" under ".claude/skills" mentions "problem, observable outcome, scope, capabilities, and material constraints"
    And the workflow skill "spok-propose" under ".claude/skills" mentions "If all five are established, proceed without asking an interview question."
    And the workflow skill "spok-propose" under ".claude/skills" mentions "Ask exactly one consequential question per message."
    And the workflow skill "spok-propose" under ".claude/skills" mentions "Offer 2–3 concrete options"
    And the workflow skill "spok-propose" under ".claude/skills" mentions "Do not ask for information the request or prior answers already establish."
    And the workflow skill "spok-propose" under ".claude/skills" mentions "Repaint the affected proposal, spec, or design section"
    And the workflow skill "spok-propose" under ".claude/skills" mentions "Never append an interview transcript."

  Scenario: Research stays evidence-first and bounds follow-up work
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-research" under ".claude/skills" mentions "Read the supplied `<task-dir>/research-questions.md` immediately and fully"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "Never read `<task-dir>/ticket.md`"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "takeaway-first headers"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "Cite every factual finding"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "Testing patterns"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "Use a diagram only when"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "At most one targeted follow-up pass"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "repaint the affected sections"
    And the workflow skill "spok-create-research" under ".claude/skills" mentions "Open Questions"

  Scenario: Design resolves one decision at a time before completing its artifact
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Ask exactly one consequential design question per message."
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "2–3 concrete options"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "tradeoffs and a recommendation"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Wait for the answer before asking the next question."
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Do not create or edit `<task-dir>/design-discussion.md` until every consequential decision is resolved"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Its existence marks this flow step complete."
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "System Design"
    And the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Program Design"

  Scenario: Planning artifacts enforce typed authority instead of chronology
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-design-discussion" under ".claude/skills" mentions "Design discussion owns behavior, scope, APIs, UX, and tradeoffs."
    And the workflow skill "spok-create-structure-outline" under ".claude/skills" mentions "Structure outline owns decomposition only."
    And the workflow skill "spok-create-structure-outline" under ".claude/skills" mentions "Chronology does not determine authority."
    And the workflow skill "spok-create-plan" under ".claude/skills" mentions "Plan owns implementation detail only."
    And the workflow skill "spok-create-plan" under ".claude/skills" mentions "It cannot override the reviewed design."
    And the workflow skill "spok-create-plan" under ".claude/skills" mentions "Unresolved or contradictory decisions block review"

  Scenario: Installed workflow assets use Spok task handoffs
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-scoped-chunks" under ".claude/skills" mentions "spok/changes/<change-slug>/tasks.md"
    And the workflow skill "spok-create-scoped-chunks" under ".claude/skills" mentions "/spok-apply <change-slug>"
    And the workflow skill resource "references/chunks_final_answer.md" under "spok-create-scoped-chunks" in ".claude/skills" contains "/spok-apply <change-slug>"
    And the workflow skill resource "references/chunk_ticket_template.md" under "spok-create-scoped-chunks" in ".claude/skills" contains "spok/changes/<change-slug>/tasks.md"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "The final commit is owned by the `commit` step in `spok-flow`."
    And the workflow skill "spok-ci-commit" under ".claude/skills" mentions "Run **every** git command with `-C <work-root>`"
    And the workflow skill "spok-ci-commit" under ".claude/skills" mentions "Stage exactly the **intersection**"
    And Spok does not create ".claude/skills/spok-create-scoped-chunks/references/chunks_overview_template.md"

  Scenario: Flow self-learn gate runs after commit when enabled
    Given a new project
    And self-learn is enabled in project config
    And a staged flow task
    And the staged flow task is completed through validation
    When I complete the staged flow commit step
    Then the Spok CLI output contains "\"state\": \"ready\""
    And the Spok CLI output contains "\"id\": \"self-learn\""
    And the Spok CLI output contains "\"skill\": \"spok-self-learn\""

  Scenario: A completed validate step re-blocks the flow when its verdict flips to FAIL
    Given a new project
    And a staged flow task
    And the staged flow task is completed through validation
    And "spok/changes/demo/.flow/chunk-one/validation.md" contains:
      """
      ---
      verdict: FAIL
      ---

      # Validation
      """
    When I attempt the staged flow commit step
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "recorded a FAIL verdict"

  Scenario: Flow records the implementation work root
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And the staged flow task is ready to implement
    When I complete the staged flow implement step with the separate work root
    Then the Spok CLI exits with code 0
    And the staged flow state records the separate work root
    And the Spok CLI output contains "\"id\": \"simplify\""
    And the editing prompt directs work to the separate work root

  Scenario: Flow steers repair to the recorded work root
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And the staged flow task is completed through validation
    And the staged flow task has the separate work root recorded
    And "spok/changes/demo/.flow/chunk-one/validation.md" contains:
      """
      ---
      verdict: FAIL
      ---

      # Validation
      """
    And a repair cycle is pending
    When I run spok flow next as JSON for the staged task
    Then the Spok CLI output contains "\"id\": \"repair\""
    And the editing prompt directs work to the separate work root

  Scenario: Flow rejects a blank implementation work root
    Given a new project
    And a staged flow task
    And the staged flow task is ready to implement
    When I attempt the staged flow implement step with a blank work root
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "absolute --work-root"

  Scenario: Flow rejects a commit outside the recorded work root
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And the staged flow task is completed through validation
    And the staged flow task has the separate work root recorded
    When I attempt the staged flow commit step with an unreachable work repository commit
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "is not reachable from HEAD in"

  Scenario: Legacy flow state warns when no work root was recorded
    Given a new project
    And a staged flow task
    And the staged flow task is completed through validation
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Work root warning: No work root was recorded"

  Scenario: Commit completion verifies an explicit work root for legacy state
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And the staged flow task is completed through validation
    When I complete the staged flow commit step with the separate work root
    Then the Spok CLI exits with code 0
    And the staged flow commit records the separate work root

  Scenario: Commit completion rejects a work root that conflicts with recorded state
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And the staged flow task is completed through validation
    And the staged flow task has the separate work root recorded
    When I attempt the staged flow commit step with a conflicting work root
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "conflicts with recorded work root"

  Scenario: Flow next prints the Claude-routed model and effort for the first step
    Given a new project
    And the Claude harness is active
    And a staged flow task
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: validate-problem"
    And the Spok CLI output contains "Model: opus"
    And the Spok CLI output contains "Effort: medium"

  Scenario: Flow next prints the Claude-routed model and effort for a max step
    Given a new project
    And the Claude harness is active
    And a staged flow task
    And the staged flow task is completed through research
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: design-discussion"
    And the Spok CLI output contains "Model: fable"
    And the Spok CLI output contains "Effort: xhigh"

  Scenario: Flow next routes validate to a model other than the implementer's
    Given a new project
    And the Claude harness is active
    And a staged flow task
    And the staged flow task is completed through simplify
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: validate"
    And the Spok CLI output contains "Model: fable"
    And the Spok CLI output contains "Effort: high"

  Scenario: Flow reviews the design before exposing planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: design-review"
    And the Spok CLI output does not contain "Next step: plan"

  Scenario: A passing design review advances the flow to planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    And "spok/changes/demo/.flow/chunk-one/design-review.md" contains:
      """
      ---
      type: design-review
      verdict: PASS
      ---

      # Design Review
      """
    When I attempt the staged flow design-review step
    Then the Spok CLI exits with code 0
    And the Spok CLI output contains "\"id\": \"plan\""

  Scenario: A failing design review blocks planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    And "spok/changes/demo/.flow/chunk-one/design-review.md" contains:
      """
      ---
      type: design-review
      verdict: FAIL
      ---

      # Design Review
      """
    When I attempt the staged flow design-review step
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "\"state\": \"blocked\""
    And the Spok CLI output contains "recorded a FAIL verdict"

  Scenario: A passing verdict with the wrong artifact type blocks planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    And "spok/changes/demo/.flow/chunk-one/design-review.md" contains:
      """
      ---
      type: validation
      verdict: PASS
      ---

      # Design Review
      """
    When I attempt the staged flow design-review step
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "\"state\": \"blocked\""
    And the Spok CLI output contains "has no readable verdict"

  Scenario: An unrecognized design-review verdict blocks planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    And "spok/changes/demo/.flow/chunk-one/design-review.md" contains:
      """
      ---
      type: design-review
      verdict: MAYBE
      ---

      # Design Review
      """
    When I attempt the staged flow design-review step
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "\"state\": \"blocked\""
    And the Spok CLI output contains "has no readable verdict"

  Scenario: A design-review verdict outside frontmatter blocks planning
    Given a new project
    And a staged flow task
    And the staged flow task is completed through structure outline
    And "spok/changes/demo/.flow/chunk-one/design-review.md" contains:
      """
      ---
      type: design-review
      ---

      # Design Review

      verdict: PASS
      """
    When I attempt the staged flow design-review step
    Then the Spok CLI exits with code 1
    And the Spok CLI output contains "\"state\": \"blocked\""
    And the Spok CLI output contains "has no readable verdict"

  Scenario: Flow next prints the Codex-routed model and effort for the first step
    Given a new project
    And the Codex harness is active
    And a staged flow task
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: validate-problem"
    And the Spok CLI output contains "Model: gpt-5.6-sol"
    And the Spok CLI output contains "Effort: xhigh"

  Scenario: Hybrid flow starts problem validation on Codex Sol
    Given a new project
    And the hybrid flow profile is active
    And a staged flow task
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Profile: hybrid"
    And the Spok CLI output contains "Runner: codex"
    And the Spok CLI output contains "Model: gpt-5.6-sol"
    And the Spok CLI output contains "Effort: xhigh"

  Scenario: Hybrid flow routes research questions to Codex Sol at medium effort
    Given a new project
    And the hybrid flow profile is active
    And a staged flow task
    And the staged flow task is completed through problem validation
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: research-questions"
    And the Spok CLI output contains "Profile: hybrid"
    And the Spok CLI output contains "Runner: codex"
    And the Spok CLI output contains "Model: gpt-5.6-sol"
    And the Spok CLI output contains "Effort: medium"

  Scenario: Hybrid flow routes design discussion to Claude Fable
    Given a new project
    And the hybrid flow profile is active
    And a staged flow task
    And the staged flow task is completed through research
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Profile: hybrid"
    And the Spok CLI output contains "Runner: claude"
    And the Spok CLI output contains "Model: fable"
    And the Spok CLI output contains "Effort: xhigh"

  Scenario: Hybrid flow routes a pending repair to Codex Sol at max effort
    Given a new project
    And the hybrid flow profile is active
    And a staged flow task
    And the staged flow task is completed through validation
    And "spok/changes/demo/.flow/chunk-one/validation.md" contains:
      """
      ---
      verdict: FAIL
      ---

      # Validation
      """
    And a repair cycle is pending
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: repair"
    And the Spok CLI output contains "Profile: hybrid"
    And the Spok CLI output contains "Runner: codex"
    And the Spok CLI output contains "Model: gpt-5.6-sol"
    And the Spok CLI output contains "Effort: max"

  Scenario: Auto flow status leaves the ready step unresolved
    Given a new project
    And the auto flow profile is active
    And a staged flow task
    When I run spok flow status for the staged task
    Then the Spok CLI output contains "Next step: validate-problem"
    And the Spok CLI output contains "Profile: auto"
    And the Spok CLI output contains "Route: unresolved until spok flow next"
    And the Spok CLI output does not contain "Runner:"

  Scenario: Global skills install writes to home-scoped tool directories
    Given a new project
    When I install global Spok skills for the tools "claude,codex,factory"
    Then Spok creates global skills under ".claude/skills"
    And Spok creates the global workflow skill "spok-explore" under ".claude/skills"
    And Spok creates the global workflow skill "spok-self-learn" under ".claude/skills"
    And Spok creates global skills under ".agents/skills"
    And Spok creates the global workflow skill "spok-explore" under ".agents/skills"
    And Spok creates the global workflow skill "spok-self-learn" under ".agents/skills"
    And Spok creates global skills under ".factory/skills"
    And Spok creates the global workflow skill "spok-explore" under ".factory/skills"
    And Spok creates the global workflow skill "spok-self-learn" under ".factory/skills"
    And Spok creates the global agent "spok-codebase-locator.md" under ".claude/agents"
    And Spok creates the global agent "spok-implementer-agent.md" under ".claude/agents"
    And Spok creates the global agent "spok-codebase-locator.toml" under ".codex/agents"
    And Spok creates the global agent "spok-implementer-agent.toml" under ".codex/agents"
    And Spok creates 5 global agents under ".claude/agents"
    And Spok creates 5 global agents under ".codex/agents"
    And Spok does not create global agents under ".factory/agents"
    And setup guidance mentions "5 Spok agents in ~/.claude/agents"
    And setup guidance mentions "5 Spok agents in ~/.codex/agents"
    And Spok does not create "spok"

  Scenario: Global update repairs an agent-only installation without project state
    Given a new project
    When I install global Spok skills for the tools "codex"
    And I remove global Spok skills under ".agents/skills"
    And I remove the global agent "spok-codebase-locator.toml" under ".codex/agents"
    And I run spok update globally
    Then Spok creates the global workflow skill "spok-flow" under ".agents/skills"
    And Spok creates the global agent "spok-codebase-locator.toml" under ".codex/agents"
    And the Spok CLI output contains "Global Spok Skills Updated"
    And Spok does not create "spok"

  Scenario: Installed workflows use Spok-prefixed agents with host-neutral delegation
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-create-research-questions" under ".claude/skills" mentions "spok-codebase-locator"
    And the workflow skill "spok-create-research-questions" under ".claude/skills" mentions "spok-codebase-analyzer"
    And the workflow skill "spok-create-research-questions" under ".claude/skills" mentions "spok-codebase-pattern-finder"
    And the workflow skill "spok-create-research-questions" under ".claude/skills" mentions "spok-web-search-researcher"
    And the workflow skill "spok-validate-implementation" under ".claude/skills" mentions "spok-codebase-analyzer"
    And the workflow skill "spok-validate-implementation" under ".claude/skills" does not mention "spok-qa"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "spok-implementer-agent"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "the current host's native subagent mechanism"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "host-owned `general-purpose`"

  Scenario: Interactive init creates missing agents for selected harnesses
    Given a new project
    And an empty home directory for agent readiness
    When I initialize Spok interactively for the tools "claude,codex" and accept agent creation
    Then setup guidance mentions "Create missing Spok agents for Claude Code and Codex?"
    And Spok creates 5 home agents under ".claude/agents"
    And Spok creates 5 home agents under ".codex/agents"

  Scenario: Project commands warn about missing global agents without installing them
    Given a new project
    And an empty home directory for agent readiness
    When I initialize Spok for the tools "claude,codex"
    Then setup guidance mentions "Missing Spok agents for Claude Code"
    And setup guidance mentions "Missing Spok agents for Codex"
    And project setup does not create global agent directories
    When I update Spok with force
    Then setup guidance mentions "Missing Spok agents for Claude Code"
    And setup guidance mentions "Missing Spok agents for Codex"
    And project setup does not create global agent directories
