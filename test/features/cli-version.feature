Feature: CLI version output
  Spok exposes its version through a command.

  Scenario: Version command prints the package version
    When I run the Spok CLI with "version"
    Then the Spok CLI output matches "package.json" version

  Scenario: Removed global options are rejected
    When I run the Spok CLI with "--version"
    Then the Spok CLI rejects the unknown option "--version"
    When I run the Spok CLI with "-V"
    Then the Spok CLI rejects the unknown option "-V"
    When I run the Spok CLI with "--no-color"
    Then the Spok CLI rejects the unknown option "--no-color"

  Scenario: Help lists version and help before other commands
    When I run the Spok CLI with "--help"
    Then the Spok CLI commands start with:
      | version |
      | help    |

  Scenario: Skills help is explicit for agents
    When I run the Spok CLI with "skills --help"
    Then the Spok CLI commands are:
      | install |
    And the Spok CLI output contains "Examples:"
    And the Spok CLI output contains "spok skills install --tools claude,codex,factory"
    And the Spok CLI output contains "Help:"
    And the Spok CLI output contains "spok help skills"
    And the Spok CLI output contains "spok skills install --help"

  Scenario: Capabilities JSON describes nested commands
    When I run the Spok CLI with "capabilities --json"
    Then the Spok CLI output is valid JSON
    And the Spok CLI capabilities include command "flow status"
    And the Spok CLI capabilities include command "flow next"
    And the Spok CLI capabilities include command "flow complete"
    And the Spok CLI capabilities include command "new change"
    And the Spok CLI capabilities include command "doctor"

  Scenario: Misleading nested skills help gives a correction
    When I run the Spok CLI with "skills help skills"
    Then the Spok CLI output rejects skills help form "skills"
    And the Spok CLI error contains "spok help skills"
    And the Spok CLI error contains "spok skills --help"
    And the Spok CLI error contains "spok skills install --help"
