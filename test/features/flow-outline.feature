Feature: Flow implementation artifact selection
  Supported flows implement the reviewed structure outline, simplify, review, and then commit.
  Saved flows that include a removed step are rejected without changing their files,
  unless the saved flow already finished.

  Scenario: A fresh graph runs from research questions to commit
    Given a new project
    And a staged flow task
    When I request the outline flow status
    Then the outline flow next step is "research-questions"
    And the outline flow graph is "research-questions, research, cause-check, design-discussion, structure-outline, implement, simplify, review, commit"

  Scenario Outline: The saved graph selects the implementation artifact
    Given a new project
    And a staged flow task
    And the outline flow has "<plan>" plan content
    And the staged flow task is completed through structure outline
    When I request the outline flow status
    Then the outline flow next step is "implement"
    And the outline flow explicitly selects "<artifact>"
    And the outline flow graph has "no" planning step
    When implementation is recorded as completed in the outline flow fixture
    Then the outline flow next step is "simplify"
    And the outline flow explicitly selects "<artifact>"

    Examples:
      | plan   | artifact             |
      | absent | structure-outline.md |
      | stale  | structure-outline.md |

  Scenario Outline: A saved removed step is blocked without changing task files
    Given a new project
    And a staged flow task
    And the outline flow has "stale" plan content
    And the staged flow task is completed through structure outline
    And the outline flow saved graph contains the "<step>" step
    When I request the outline flow status
    Then the outline flow is blocked because the "<step>" step was removed
    And the outline flow task files are unchanged

    Examples:
      | step             |
      | plan             |
      | validate-problem |
      | design-review    |
      | validate         |
      | repair           |
      | self-learn       |

  Scenario: A finished legacy flow still reports completion and its execution
    Given a new project
    And a staged flow task
    And the outline flow saved graph is a finished legacy flow
    When I request the outline flow status
    Then the outline flow state is "complete" with its recorded execution
    And the outline flow task files are unchanged
    When I request the outline flow next step
    Then the outline flow state is "complete" with its recorded execution
    And the outline flow task files are unchanged

  Scenario: A finished flow from the earlier six-step graph stays complete
    Given a new project
    And a staged flow task
    And the outline flow saved graph is a finished six-step flow
    When I request the outline flow next step
    Then the outline flow state is "complete" with its recorded execution
    And the outline flow task files are unchanged
