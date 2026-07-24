Feature: Archive validation reporting
  Archiving reports proposal issues without repeating rules the delta specs
  already enforce, and names the location of every issue it does report.

  Scenario: Removal-only delta specs archive without requirement noise
    Given a Spok workspace
    And main spec "cli-command-surface" contains:
      """
      # cli-command-surface Specification

      ## Purpose

      Define the commands the Spok CLI exposes and the entry points agents rely on.

      ## Requirements

      ### Requirement: Flow Agent Research Command
      ### Requirement: Flow Agent Design Command
      ### Requirement: Flow Agent Plan Command
      ### Requirement: Flow Agent Implement Command
      ### Requirement: Flow Agent Validate Command
      ### Requirement: Flow Agent Repair Command
      ### Requirement: Flow Agent Simplify Command
      ### Requirement: Flow Agent Commit Command
      ### Requirement: Flow Agent Review Command
      ### Requirement: Flow Agent Status Command
      ### Requirement: Flow Agent Next Command
      ### Requirement: Flow Agent Complete Command

      ### Requirement: Archive Command
      The CLI SHALL expose an archive command.

      #### Scenario: Archiving a change
      - **WHEN** a completed change is archived
      - **THEN** its deltas are applied to the main specs
      """
    And change "remove-commands" has proposal:
      """
      # Change: remove-commands

      ## Why

      The flow agent commands duplicate the skill surface and confuse agents
      about which entry point is authoritative.

      ## What Changes

      - Drop the retired flow agent commands.
      """
    And change "remove-commands" has delta spec "cli-command-surface":
      """
      # CLI Command Surface - Changes

      ## REMOVED Requirements

      ### Requirement: Flow Agent Research Command
      ### Requirement: Flow Agent Design Command
      ### Requirement: Flow Agent Plan Command
      ### Requirement: Flow Agent Implement Command
      ### Requirement: Flow Agent Validate Command
      ### Requirement: Flow Agent Repair Command
      ### Requirement: Flow Agent Simplify Command
      ### Requirement: Flow Agent Commit Command
      ### Requirement: Flow Agent Review Command
      ### Requirement: Flow Agent Status Command
      ### Requirement: Flow Agent Next Command
      ### Requirement: Flow Agent Complete Command
      """
    When I archive change "remove-commands"
    Then the archive output does not contain "Requirement must contain SHALL or MUST keyword"
    And the archive output does not contain "Requirement must have at least one scenario"
    And the archive output does not contain "Consider splitting changes with more than 10 deltas"
    And change "remove-commands" is archived

  Scenario: Proposal issues outside the deltas survive the filter
    Given a Spok workspace
    And main spec "cli-command-surface" contains:
      """
      # cli-command-surface Specification

      ## Purpose

      Define the commands the Spok CLI exposes and the entry points agents rely on.

      ## Requirements

      ### Requirement: Flow Agent Research Command

      ### Requirement: Archive Command
      The CLI SHALL expose an archive command.

      #### Scenario: Archiving a change
      - **WHEN** a completed change is archived
      - **THEN** its deltas are applied to the main specs
      """
    And change "thin-why" has proposal:
      """
      # Change: thin-why

      ## Why

      Too short.

      ## What Changes

      - Drop a requirement.
      """
    And change "thin-why" has delta spec "cli-command-surface":
      """
      # CLI Command Surface - Changes

      ## REMOVED Requirements

      ### Requirement: Flow Agent Research Command
      """
    When I archive change "thin-why"
    Then the archive output contains "✗ why: Why section must be at least 50 characters"
    And the archive output does not contain "Requirement must contain SHALL or MUST keyword"
    And change "thin-why" is archived

  Scenario: Delta spec errors name the file that failed
    Given a Spok workspace
    And change "bad-delta" has proposal:
      """
      # Change: bad-delta

      ## Why

      A requirement was added without the scenario that proves the behaviour,
      so the delta spec must be rejected before it reaches the main specs.

      ## What Changes

      - Add a requirement.
      """
    And change "bad-delta" has delta spec "broken":
      """
      # Broken - Changes

      ## ADDED Requirements

      ### Requirement: Scenarioless Requirement
      The system SHALL do something that nobody bothered to demonstrate.
      """
    When I archive change "bad-delta"
    Then the archive output contains "✗ broken/spec.md: ADDED \"Scenarioless Requirement\" must include at least one scenario"
    And change "bad-delta" is not archived
