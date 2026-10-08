Feature: Flow implementation artifact selection
  Supported flows implement the reviewed structure outline. Saved flows that
  include a plan step are rejected without changing their files.

  Scenario Outline: The saved graph selects the implementation artifact
    Given a new project
    And a staged flow task
    And the outline flow has "<plan>" plan content
    And the staged flow task is completed through structure outline
    When I pass the outline flow design review
    Then the outline flow next step is "implement"
    And the outline flow explicitly selects "<artifact>"
    And the outline flow graph has "no" planning step
    When implementation is recorded as completed in the outline flow fixture
    Then the outline flow next step is "simplify"
    And the outline flow explicitly selects "<artifact>"
    When I complete the outline flow summary step "simplify"
    Then the outline flow next step is "validate"
    And the outline flow explicitly selects "<artifact>"
    When I complete outline flow validation with "FAIL"
    Then the outline flow next step is "repair"
    And the outline flow explicitly selects "<artifact>"
    When I complete the outline flow summary step "repair"
    Then the outline flow next step is "validate"
    And the outline flow explicitly selects "<artifact>"
    When I complete outline flow validation with "PASS"
    Then the outline flow next step is "commit"
    And the outline flow explicitly selects "<artifact>"

    Examples:
      | plan   | artifact             |
      | absent | structure-outline.md |
      | stale  | structure-outline.md |

  Scenario: A saved plan step is blocked without changing task files
    Given a new project
    And a staged flow task
    And the outline flow has "stale" plan content
    And the staged flow task is completed through structure outline
    And the outline flow saved graph contains a plan step
    When I request the unsupported outline flow status
    Then the outline flow is blocked because the plan step was removed
    And the outline flow task files are unchanged
