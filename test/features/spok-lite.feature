Feature: Spok lite skills
  Spok installs the lite interview and execute skills alongside the full flow.

  Scenario: Init installs the lite skills for Claude and Codex
    Given a new project
    When I initialize Spok for the tools "claude,codex"
    Then Spok creates the workflow skill "spok-interview" under ".claude/skills"
    And Spok creates the workflow skill "spok-execute" under ".claude/skills"
    And Spok creates the workflow skill "spok-interview" under ".agents/skills"
    And Spok creates the workflow skill "spok-execute" under ".agents/skills"
    And the workflow skill "spok-interview" under ".claude/skills" mentions "/spok-execute"
    And the workflow skill "spok-execute" under ".claude/skills" mentions "[!] blocked:"

  Scenario: CLI project update reinstalls the lite skills
    Given a new project
    And the project directory is the isolated home
    When I run the Spok CLI in the project with "init --tools claude,codex --force"
    Then the Spok CLI exits with code 0
    When I run the Spok CLI in the project with "update --force"
    Then the Spok CLI exits with code 0
    And Spok creates the workflow skill "spok-interview" under ".claude/skills"
    And Spok creates the workflow skill "spok-execute" under ".claude/skills"
    And Spok creates the workflow skill "spok-interview" under ".agents/skills"
    And Spok creates the workflow skill "spok-execute" under ".agents/skills"
