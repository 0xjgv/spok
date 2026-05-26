#!/usr/bin/env bash
# PreToolUse(Bash) hook: deny git commit / push without captured intent.
set -euo pipefail

STATE_FILE="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/state/commit-intent"
PYTHON3="${PYTHON3:-$(command -v python3 || echo /usr/bin/python3)}"

payload=$(cat)
command=$(printf '%s' "$payload" | "$PYTHON3" -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))')

# Only intercept git commit / push. Everything else passes through.
if ! printf '%s' "$command" | grep -Eq '\bgit[[:space:]]+(commit|push)\b'; then
  exit 0
fi

deny() {
  "$PYTHON3" -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}

if [[ ! -f "$STATE_FILE" ]]; then
  deny "no commit-intent captured from user prompt; user must explicitly request commit/push (verbs: commit, push, ship, land, merge)"
fi

expires_at=$("$PYTHON3" -c 'import json,sys; print(json.load(open(sys.argv[1])).get("expires_at",0))' "$STATE_FILE")
now=$(date +%s)
if (( now > expires_at )); then
  rm -f "$STATE_FILE"
  deny "commit-intent expired (turn-bounded TTL); user must re-authorize"
fi

exit 0
