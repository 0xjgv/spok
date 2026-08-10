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
    And the workflow skill "spok-flow" under ".claude/skills" mentions "subagent_type: general-purpose"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "model: <step.model>"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "effort: <step.effort>"
    And the workflow skill "spok-flow" under ".claude/skills" mentions "spok flow next --json is the source of truth"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "Spok settings live in spok/config.toml. To enable it, add:"
    And the workflow skill "spok-apply" under ".claude/skills" mentions "See available settings with: spok capabilities --json"

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
    And the workflow skill "spok-apply" under ".claude/skills" mentions "spok skills install --tools claude,codex"

  Scenario: Inner flow implementation overrides standalone orchestration
    Given a new project
    When I initialize Spok for the tools "claude"
    Then the workflow skill "spok-implement-plan" under ".claude/skills" mentions "override every conflicting instruction anywhere in this skill"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "In inner spok-flow mode, resume directly"
    And the workflow skill "spok-implement-plan" under ".claude/skills" mentions "Outside inner spok-flow mode, launch separate"
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
    And Spok does not create "spok"
