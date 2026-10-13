Feature: Per-phase review gate
  The user reviews after every phase. Completing a gated phase asks one review
  question; approving advances, and any other answer reruns the phase with that
  feedback. The commit step is not gated.

  Scenario: Completing a phase asks for review
    Given a new project
    And a staged flow task
    When the review flow completes "research-questions"
    Then the review flow state is "needs-input"
    And the review question id is "research-questions-review-1"
    And the review question prompt names "research-questions.md"
    And the review question offers "approve, revise" and recommends "approve"
    And the review flow step "research-questions" is not completed

  Scenario Outline: Approving advances to the next phase
    Given a new project
    And a staged flow task
    When the review flow completes "research-questions"
    And the review flow answers "<answer>"
    Then the review flow state is "ready"
    And the review flow step "research-questions" is completed
    When I request the next review flow step
    Then the review flow next step is "research"

    Examples:
      | answer     |
      | approve    |
      |  Approve   |

  Scenario: Requesting changes reruns the phase with the feedback
    Given a new project
    And a staged flow task
    When the review flow completes "research-questions"
    And the review flow answers "Tighten the scope section"
    Then the review flow state is "ready"
    And the review flow step "research-questions" is not completed
    When I request the next review flow step
    Then the review flow next step is "research-questions"
    And the review flow step prompt contains "Tighten the scope section"
    And the review flow step prompt contains "A reviewer requested changes to"
    And the review flow step prompt contains "Revise it in place to address the feedback"
    And the review flow artifact "research-questions.md" still exists
    When the review flow completes "research-questions"
    Then the review flow state is "needs-input"
    And the review question id is "research-questions-review-2"

  Scenario: Implementation revisions keep the cumulative changed paths
    Given a new project
    And a staged flow task in a linked worktree
    And the staged flow task is ready to implement
    When I request the next review flow step
    Then the review flow next step is "implement"
    When the review flow writes "one.txt" in the work root
    And the review flow completes implement with changed paths "one.txt"
    Then the review flow state is "needs-input"
    And the review question id is "implement-review-1"
    And the review question prompt names "implementation"
    When the review flow answers "Also add two.txt"
    And I request the next review flow step
    Then the review flow next step is "implement"
    And the review flow step prompt contains "Also add two.txt"
    When the review flow writes "two.txt" in the work root
    And the review flow completes implement with changed paths "one.txt,two.txt"
    Then the review flow state is "needs-input"
    And the review question id is "implement-review-2"
    When the review flow answers "approve"
    Then the review flow state is "ready"
    And the review flow owned paths are "one.txt,two.txt"
    When I request the next review flow step
    Then the review flow next step is "commit"

  Scenario: The commit step is not gated
    Given a new project
    And a staged flow task in a linked worktree
    And the staged flow task is ready to implement
    When I request the next review flow step
    And the review flow writes "one.txt" in the work root
    And the review flow completes implement with changed paths "one.txt"
    And the review flow answers "approve"
    And I request the next review flow step
    And the review flow commits the owned paths
    Then the review flow state is "complete"
