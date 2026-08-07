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

  Scenario: A change without a ticket lists no ticket
    Given a Spok workspace
    And change "no-ticket" has metadata:
      """
      schema: spec-driven
      """
    When I list the workspace changes as JSON
    Then the listed change "no-ticket" has no ticket
