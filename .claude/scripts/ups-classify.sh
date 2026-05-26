#!/usr/bin/env bash
# UserPromptSubmit hook: classify the user prompt and write short-TTL state files.
# - Always wipes prior state on entry (true turn-bounding).
# - Writes commit-intent when the prompt has a commit/push verb in action context.
# - Writes edit-auth only when a verb + protected-path co-occur within ~80 chars.
set -euo pipefail

STATE_DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/state"
TTL_SECONDS="${COMMIT_INTENT_TTL:-300}"
PYTHON3="${PYTHON3:-$(command -v python3 || echo /usr/bin/python3)}"

mkdir -p "$STATE_DIR"
rm -f "$STATE_DIR/commit-intent" "$STATE_DIR/edit-auth"

payload_file=$(mktemp)
trap 'rm -f "$payload_file"' EXIT
cat > "$payload_file"

STATE_DIR="$STATE_DIR" TTL_SECONDS="$TTL_SECONDS" PAYLOAD_FILE="$payload_file" "$PYTHON3" <<'PYEOF'
import json, os, re, time

state_dir = os.environ["STATE_DIR"]
ttl = int(os.environ["TTL_SECONDS"])
with open(os.environ["PAYLOAD_FILE"]) as f:
    prompt = json.load(f).get("prompt", "") or ""

# Commit / push intent.
if re.search(r"\b(commit|push|ship|land|merge)\b", prompt, re.IGNORECASE):
    with open(os.path.join(state_dir, "commit-intent"), "w") as f:
        json.dump({"expires_at": int(time.time()) + ttl}, f)

# Protected-path edit authorization: require (verb within 80 chars of path).
# Loose enough to catch natural phrasings, tight enough to reject incidental mentions.
PROTECTED = [".dependency-cruiser.json"]
VERBS = r"(?:edit|update|change|modify|write|fix|adjust|tweak|set|add|remove|delete|rewrite)"
authorized = []
for path in PROTECTED:
    window = rf"(?:{VERBS}\b[^\n]{{0,80}}{re.escape(path)}|{re.escape(path)}[^\n]{{0,80}}\b{VERBS})"
    if re.search(window, prompt, re.IGNORECASE):
        authorized.append(path)
if authorized:
    with open(os.path.join(state_dir, "edit-auth"), "w") as f:
        json.dump({"expires_at": int(time.time()) + ttl, "paths": authorized}, f)
PYEOF

exit 0
