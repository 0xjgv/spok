@artifact-output-safety
Feature: Artifact output safety
  Artifact completion only considers files inside the change directory.

  Scenario: Outside files cannot complete artifacts
    Given a change with traversal and symlink artifact outputs
    When I request JSON status for the change
    Then neither outside artifact output is resolved
    And the change is not complete
