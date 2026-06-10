Feature: CLI version output
  Spok exposes its version through command and flag forms.

  Scenario: Version command matches the version flags
    When I run the Spok CLI with "version"
    Then the Spok CLI output matches "package.json" version
    When I run the Spok CLI with "--version"
    Then the Spok CLI output matches "package.json" version
    When I run the Spok CLI with "-V"
    Then the Spok CLI output matches "package.json" version
