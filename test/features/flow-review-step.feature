Feature: Simplify and correctness review
  After implementation, simplify stays inside the implementation allowlist and the
  correctness review must record a PASS verdict before the flow can commit.

  Background:
    Given a new project
    And a staged flow task in a linked worktree
    And the staged flow task is ready to implement
    When I request the next review flow step
    And the review flow writes "one.txt" in the work root
    And the review flow completes implement with changed paths "one.txt"

  Scenario: Simplify may not change paths outside the allowlist
    When I request the next review flow step
    And the review flow writes "extra.txt" in the work root
    And the review flow tries to complete simplify
    Then the review flow is blocked with "Changes outside execution scope: extra.txt"

  Scenario: A FAIL review verdict blocks the commit
    When I request the next review flow step
    And the review flow completes simplify
    And I request the next review flow step
    And the review flow tries to record a "FAIL" review
    Then the review flow is blocked with "Step review recorded a FAIL verdict"
    And the review flow next step is "review"

  Scenario: A review without a readable verdict blocks the commit
    When I request the next review flow step
    And the review flow completes simplify
    And I request the next review flow step
    And the review flow tries to record a "MAYBE" review
    Then the review flow is blocked with "Step review has no readable verdict"

  Scenario: The review prompt names the evidence and the allowlist
    When I request the next review flow step
    And the review flow completes simplify
    And I request the next review flow step
    Then the review flow next step is "review"
    And the review flow step prompt contains "evidence/causal-paths.md"
    And the review flow step prompt contains "Exact implementation allowlist: [\"one.txt\"]"
