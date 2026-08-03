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

  Scenario: Wrapped normative keywords survive archive validation
    Given a Spok workspace
    And main spec "publication" contains:
      """
      # publication Specification

      ## Purpose

      Define how completed reviews are published.

      ## Requirements

      ### Requirement: Hold blocked publication
      The system SHALL hold publication while CI is blocked.

      #### Scenario: CI blocks publication
      - **WHEN** CI is blocked
      - **THEN** publication remains held
      """
    And change "wrap-publication-rule" has proposal:
      """
      # Change: wrap-publication-rule

      ## Why

      The publication rule needs enough context to explain why completed clean
      reviews remain held while continuous integration is still blocked.

      ## What Changes

      - Clarify the existing publication requirement.
      """
    And change "wrap-publication-rule" has delta spec "publication":
      """
      # Publication - Changes

      ## MODIFIED Requirements

      ### Requirement: Hold blocked publication
      A completed review remains unavailable for publication while CI is blocked.
      The system SHALL keep that review held until the blocking state clears.

      #### Scenario: CI blocks publication
      - **WHEN** CI is blocked
      - **THEN** publication remains held
      """
    When I archive change "wrap-publication-rule"
    Then the archive output does not contain "must contain SHALL or MUST"
    And change "wrap-publication-rule" is archived

  Scenario: Applicability errors are reported together before archive writes
    Given a Spok workspace
    And main spec "approval" contains:
      """
      # approval Specification

      ## Purpose

      Define approval behavior for held reviews.

      ## Requirements

      ### Requirement: Existing approval
      The system SHALL retain existing approval state.

      #### Scenario: Approval is retained
      - **WHEN** a review remains unchanged
      - **THEN** its approval remains valid
      """
    And main spec "memory" contains:
      """
      # memory Specification

      ## Purpose

      Define how review memory reaches synthesis.

      ## Requirements

      ### Requirement: Existing memory
      The system SHALL inject existing memory into synthesis.

      #### Scenario: Memory is injected
      - **WHEN** synthesis begins
      - **THEN** existing memory is available
      """
    And change "stale-requirements" has proposal:
      """
      # Change: stale-requirements

      ## Why

      Two requirements were classified as modifications even though neither
      header exists in its corresponding canonical specification.

      ## What Changes

      - Attempt to modify two stale requirement headers.
      """
    And change "stale-requirements" has delta spec "approval":
      """
      # Approval - Changes

      ## MODIFIED Requirements

      ### Requirement: Mutated held reviews cannot be edited
      The system SHALL reject edits to mutated held reviews.

      #### Scenario: A held review mutates
      - **WHEN** an approved held review changes
      - **THEN** editing is rejected
      """
    And change "stale-requirements" has delta spec "memory":
      """
      # Memory - Changes

      ## MODIFIED Requirements

      ### Requirement: Memory reaches only synthesis and voice
      The system SHALL inject memory only into synthesis and voice.

      #### Scenario: Memory is injected
      - **WHEN** review execution begins
      - **THEN** only synthesis and voice receive memory
      """
    When I archive change "stale-requirements"
    Then the archive output contains "approval MODIFIED failed for header \"### Requirement: Mutated held reviews cannot be edited\" - not found"
    And the archive output contains "memory MODIFIED failed for header \"### Requirement: Memory reaches only synthesis and voice\" - not found"
    And the archive output contains "Use ADDED for new requirements, or RENAMED followed by MODIFIED when a requirement name changes."
    And change "stale-requirements" is not archived
