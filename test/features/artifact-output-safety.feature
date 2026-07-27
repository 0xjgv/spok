@artifact-output-safety
Feature: Artifact output safety
  Artifact completion only considers files inside the change directory.

  Scenario: Outside files cannot complete artifacts
    Given a change with traversal and symlink artifact outputs
    When I request JSON status for the change
    Then neither outside artifact output is resolved
    And the change is not complete

  Scenario Outline: Outside files cannot supply apply tasks
    Given a change whose tracking file escapes by "<method>"
    When I request JSON apply instructions for the change
    Then outside apply tasks are not loaded
    And apply is blocked because the tracking file is missing

    Examples:
      | method    |
      | traversal |
      | symlink   |
