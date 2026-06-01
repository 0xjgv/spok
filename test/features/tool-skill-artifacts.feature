Feature: Tool skill artifacts
  Spok installs workflow skills without creating slash-command wrapper files.

  Scenario: Claude and Codex setup creates only Claude and Agents skills
    Given a new project
    When I initialize Spok for the tools "claude,codex"
    Then Spok creates skills under ".claude/skills"
    And Spok creates the workflow skill "spok-explore" under ".claude/skills"
    And Spok creates skills under ".agents/skills"
    And Spok creates the workflow skill "spok-explore" under ".agents/skills"
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
