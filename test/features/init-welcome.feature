Feature: Init welcome screen
  Spok keeps the welcome frame stable in interactive terminals.

  Scenario: An 80-column terminal renders one static welcome frame
    Given an interactive terminal 80 columns wide
    When I show the init welcome screen
    Then the welcome output contains "Welcome to Spok" once
    And the welcome output emits no cursor-up animation
