---
version: 0.1.0
---

# Linear Tickets

Spok can attach a Linear issue to a change. Tickets are metadata on a change — specs never carry them.

Spok ships no Linear API code, no tokens, and no extra dependencies. The transport is your own Linear MCP connection.

## Connect Linear

Add Linear's official MCP server, `https://mcp.linear.app/mcp`, to your AI tool. Linear documents the setup for each client at <https://linear.app/docs/mcp>.

## Propose from an issue

Pass an issue reference to `/spok-propose` — either the identifier or the issue URL:

```text
/spok-propose ENG-123
/spok-propose https://linear.app/acme/issue/ENG-123
```

The skill fetches the issue with the Linear MCP tools, uses its title and description as proposal input, and records the reference in the change's `.spok.yaml`:

```yaml
schema: spec-driven
created: 2026-08-07
ticket: ENG-123
```

If the Linear MCP tools are unavailable, the skill proceeds from your own description and still records the reference.

The `ticket` field is free-form: set it by hand on any existing change, with or without Linear.

## See the ticket

`spok list` shows the ticket as a trailing column for the changes that have one:

```text
Changes:
  add-user-auth      2/5 tasks     3h ago   ENG-123
  fix-login-redirect No tasks      1d ago
```

`spok list --json` includes a `ticket` field on those changes and omits the field entirely when a change has none.
