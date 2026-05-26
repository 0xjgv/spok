#!/usr/bin/env bash
# PreToolUse(Write|Edit|MultiEdit) hook: deny writes to protected arch config
# paths unless the UserPromptSubmit classifier captured authorization.
set -euo pipefail

STATE_FILE="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/state/edit-auth"
PYTHON3="${PYTHON3:-$(command -v python3 || echo /usr/bin/python3)}"

# Protected relative paths under CLAUDE_PROJECT_DIR.
PROTECTED=(".dependency-cruiser.json")

payload=$(cat)
file_path=$(printf '%s' "$payload" | "$PYTHON3" -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("filePath") or "")')

[[ -z "$file_path" ]] && exit 0  # unrelated edit tool — allow

# Normalize to relative path.
rel="${file_path#${CLAUDE_PROJECT_DIR:-$PWD}/}"

is_protected=0
for p in "${PROTECTED[@]}"; do
  if [[ "$rel" == "$p" || "$rel" == *"/$p" ]]; then
    is_protected=1
    break
  fi
done
(( is_protected == 0 )) && exit 0  # not protected — allow

deny() {
  "$PYTHON3" -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}

if [[ ! -f "$STATE_FILE" ]]; then
  deny "edits to $rel require explicit user authorization in the current prompt (e.g., 'edit .dependency-cruiser.json to ...')"
fi

# Check TTL and path authorization.
now=$(date +%s)
authorized=$("$PYTHON3" -c '
import json,sys
path, state_file, now = sys.argv[1], sys.argv[2], int(sys.argv[3])
try:
  d = json.load(open(state_file))
except Exception:
  print("0"); sys.exit()
if int(d.get("expires_at", 0)) < now:
  print("0"); sys.exit()
paths = d.get("paths", [])
print("1" if path in paths else "0")
' "$rel" "$STATE_FILE" "$now")

if [[ "$authorized" != "1" ]]; then
  deny "edits to $rel require the user's current prompt to pair a verb (edit/update/modify/...) with the path name"
fi

exit 0
