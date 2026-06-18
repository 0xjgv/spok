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

  Scenario: Setup guidance presents explore before proposing a change
    Given a new project
    When I initialize Spok for the tools "claude"
    Then setup guidance mentions "/spok-explore"
    And setup guidance mentions "/spok-propose"
    And Spok creates file "spok/config.toml"

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

  Scenario: Flow self-learn gate runs after commit when enabled
    Given a new project
    And self-learn is enabled in project config
    And a staged flow task
    And the staged flow task is completed through validation
    When I complete the staged flow commit step
    Then the Spok CLI output contains "\"state\": \"ready\""
    And the Spok CLI output contains "\"id\": \"self-learn\""
    And the Spok CLI output contains "\"skill\": \"spok-self-learn\""

  Scenario: Flow next prints the Claude-routed model and effort for the first step
    Given a new project
    And the Claude harness is active
    And a staged flow task
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: validate-problem"
    And the Spok CLI output contains "Model: opus"
    And the Spok CLI output contains "Effort: xhigh"

  Scenario: Flow next prints the Codex-routed model and effort for the first step
    Given a new project
    And the Codex harness is active
    And a staged flow task
    When I run spok flow next for the staged task
    Then the Spok CLI output contains "Next step: validate-problem"
    And the Spok CLI output contains "Model: gpt-5.5"
    And the Spok CLI output contains "Effort: xhigh"

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
