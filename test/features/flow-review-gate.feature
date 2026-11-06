Feature: Design gate
  The design discussion is the one human gate. Completing it asks one review
  question; approving advances, and any other answer reruns the design with that
  feedback. Every other phase advances on completion; the pull request is the
  review point for implementation.

  Scenario: Research phases advance without review
    Given a new project
    And a staged flow task
    When the review flow completes "research-questions"
    Then the review flow state is "ready"
    And the review flow step "research-questions" is completed
    And the review flow next step is "research"

  Scenario: Completing the design discussion asks for review
    Given a new project
    And a staged flow task
    And the staged flow task is completed through cause check
    When the review flow completes "design-discussion"
    Then the review flow state is "needs-input"
    And the review question id is "design-discussion-review-1"
    And the review question prompt names "design-discussion.md"
    And the review question offers "approve, revise" and recommends "approve"
    And the review flow step "design-discussion" is not completed

  Scenario Outline: Approving the design advances to the outline
    Given a new project
    And a staged flow task
    And the staged flow task is completed through cause check
    When the review flow completes "design-discussion"
    And the review flow answers "<answer>"
    Then the review flow state is "ready"
    And the review flow step "design-discussion" is completed
    When I request the next review flow step
    Then the review flow next step is "structure-outline"

    Examples:
      | answer     |
      | approve    |
      |  Approve   |

  Scenario: Requesting design changes reruns the design with the feedback
    Given a new project
    And a staged flow task
    And the staged flow task is completed through cause check
    When the review flow completes "design-discussion"
    And the review flow answers "Tighten the scope section"
    Then the review flow state is "ready"
    And the review flow step "design-discussion" is not completed
    When I request the next review flow step
    Then the review flow next step is "design-discussion"
    And the review flow step prompt contains "Tighten the scope section"
    And the review flow step prompt contains "A reviewer requested changes to"
    And the review flow step prompt contains "Revise it in place to address the feedback"
    And the review flow artifact "design-discussion.md" still exists
    When the review flow completes "design-discussion"
    Then the review flow state is "needs-input"
    And the review question id is "design-discussion-review-2"

  Scenario: Design questions state the premise each option rests on
    Given a new project
    And a staged flow task
    And the staged flow task is completed through cause check
    When I request the next review flow step
    Then the review flow next step is "design-discussion"
    And the review flow step prompt contains "Rests on: <weakest premise> (verified|unverified)"

  Scenario: Implementation runs unattended through simplify, review, and commit
    Given a new project
    And a staged flow task in a linked worktree
    And the staged flow task is ready to implement
    When I request the next review flow step
    Then the review flow next step is "implement"
    When the review flow writes "one.txt" in the work root
    And the review flow completes implement with changed paths "one.txt"
    Then the review flow state is "ready"
    And the review flow owned paths are "one.txt"
    When I request the next review flow step
    Then the review flow next step is "simplify"
    When the review flow completes simplify
    And I request the next review flow step
    Then the review flow next step is "review"
    When the review flow records a "PASS" review
    And I request the next review flow step
    Then the review flow next step is "commit"
    When the review flow commits the owned paths
    Then the review flow state is "complete"
