Feature: spok run drives a flow to a terminal outcome

  Background:
    Given a new project
    And a separate flow work repository
    And a staged flow task
    And a stub harness on PATH

  Scenario: A full run completes with exit code 0
    When I run spok run on the staged flow task
    Then the spok run exits with code 0
    And the spok run reports each dispatched step in order
    And the workflow state records the commit step as completed

  Scenario: A design-review FAIL blocks the run with exit code 2
    Given the stub harness records a FAIL design review
    When I run spok run on the staged flow task
    Then the spok run exits with code 2
    And the spok run reports a blocked reason containing "recorded a FAIL verdict"

  Scenario: A failing harness exits 3 and the run resumes at the same step
    Given the stub harness fails on the research step
    When I run spok run on the staged flow task
    Then the spok run exits with code 3
    Given the stub harness is repaired
    When I run spok run on the staged flow task
    Then the spok run exits with code 0
    And the spok run resumed at the research step

  Scenario: A profile mismatch with persisted state exits 2
    Given the staged flow task has persisted workflow state under the claude profile
    When I run spok run on the staged flow task with profile "codex"
    Then the spok run exits with code 2
    And the spok run reports a blocked reason containing "Flow profile mismatch"

  Scenario: An unrecognized profile value is a usage error
    When I run spok run on the staged flow task with profile "turbo"
    Then the spok run exits with code 1
    And the staged flow task has no workflow state file

  Scenario: A full run with --json emits a parseable JSONL event stream
    When I run spok run on the staged flow task with the --json flag
    Then the spok run exits with code 0
    And every spok run stdout line is JSON with schema version 1
    And the spok run event stream reports the full flow lifecycle

  Scenario: A design-review FAIL surfaces its human decisions in the event stream
    Given the stub harness records a FAIL design review
    When I run spok run on the staged flow task with the --json flag
    Then the spok run exits with code 2
    And every spok run stdout line is JSON with schema version 1
    And the spok run event stream ends with a blocked event carrying code "design_review_verdict_fail"
    And the blocked event carries the human decisions from the design review
