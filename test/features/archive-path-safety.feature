@archive-path-safety
Feature: Archive path safety
  Explicit change names cannot escape the Spok changes directory.

  Scenario: Reject an explicit change name that traverses outside changes
    Given a Spok project with a sibling victim marker
    When I archive the explicit change "../../victim"
    Then the archive command rejects the change name "../../victim"
    And the sibling victim marker remains unchanged
