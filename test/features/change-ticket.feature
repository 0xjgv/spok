Feature: Change ticket in list output
  A change records an optional ticket reference in its metadata, and listing
  surfaces it without inventing a placeholder for changes that have none.

  Scenario: The table listing shows the ticket recorded in change metadata
    Given a Spok workspace
    And change "add-linear-tickets" has metadata:
      """
      schema: spec-driven
      ticket: ENG-123
      """
    When I list the workspace changes
    Then the list output contains "add-linear-tickets"
    And the list output contains "ENG-123"

  Scenario: The JSON listing carries the ticket
    Given a Spok workspace
    And change "add-linear-tickets" has metadata:
      """
      schema: spec-driven
      ticket: https://linear.app/acme/issue/ENG-123
      """
    When I list the workspace changes as JSON
    Then the listed change "add-linear-tickets" has ticket "https://linear.app/acme/issue/ENG-123"

  Scenario: The table listing neutralizes terminal controls in a ticket
    Given a Spok workspace
    And change "hostile-ticket" has metadata:
      """
      schema: spec-driven
      ticket: "ENG-123\x07\x1B[31m\x9B31m\x9D0;owned\u2028tail"
      """
    When I list the workspace changes
    Then the list output contains no unsafe terminal controls

  Scenario: The JSON listing safely escapes terminal controls without changing the ticket
    Given a Spok workspace
    And change "hostile-ticket" has metadata:
      """
      schema: spec-driven
      ticket: "ENG-123\x07\x1B[31m\x9B31m\x9D0;owned\u2028tail"
      """
    When I list the workspace changes as JSON
    Then the list output contains no unsafe terminal controls
    And the listed change "hostile-ticket" retains its terminal-control ticket

  Scenario: A change without a ticket lists no ticket
    Given a Spok workspace
    And change "no-ticket" has metadata:
      """
      schema: spec-driven
      """
    When I list the workspace changes as JSON
    Then the listed change "no-ticket" has no ticket
