#!/usr/bin/env bash
# SessionStart hook: reinject the role block so it survives /clear, /compact, resume.
set -euo pipefail
block="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/scripts/role-block.md"
[[ -f "$block" ]] && cat "$block"
exit 0
