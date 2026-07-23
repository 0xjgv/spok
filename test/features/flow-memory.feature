Feature: Flow memory
  Spok inlines curated repository rules into every flow step prompt.

  Scenario: Conforming rules reach the step prompt
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"
      """
    And a staged flow task
    And "spok/MEMORY.md" contains:
      """
      # Memory

      ## Rules

      - `flow-ts-first` — Read src/commands/workflow/flow.ts before editing step definitions.
      """
    When I request the next flow step as JSON
    Then the step prompt contains "Read src/commands/workflow/flow.ts before editing step definitions."

  Scenario: Prose in MEMORY.md never reaches the step prompt
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"
      """
    And a staged flow task
    And "spok/MEMORY.md" contains:
      """
      # Memory

      This paragraph is written for humans and must never reach a prompt.

      ## Rules

      - `plan-cites-lines` — When planning, cite file:line for every claim about existing code.
      """
    When I request the next flow step as JSON
    Then the step prompt contains "When planning, cite file:line for every claim about existing code."
    And the step prompt does not contain "This paragraph is written for humans"

  Scenario: An unreadable MEMORY.md still yields a dispatchable prompt
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"
      """
    And a staged flow task
    And "spok/MEMORY.md" is a directory
    When I request the next flow step as JSON
    Then the step prompt names the step skill and its argument
    And the step prompt contains no rules section
    And the flow response warns that memory could not be read

  Scenario: A project without MEMORY.md still yields a dispatchable prompt
    Given a new project
    And project config contains:
      """
      schema = "spec-driven"
      """
    And a staged flow task
    When I request the next flow step as JSON
    Then the step prompt names the step skill and its argument
    And the step prompt contains no rules section
