/**
 * Static template strings for Zsh completion scripts.
 * These are Zsh-specific helper functions that never change.
 */

export const ZSH_DYNAMIC_HELPERS = `# Dynamic completion helpers

# Use spok __complete to get available changes
_spok_complete_changes() {
  local -a changes
  while IFS=$'\\t' read -r id desc; do
    changes+=("$id:$desc")
  done < <(spok __complete changes 2>/dev/null)
  _describe "change" changes
}

# Use spok __complete to get available specs
_spok_complete_specs() {
  local -a specs
  while IFS=$'\\t' read -r id desc; do
    specs+=("$id:$desc")
  done < <(spok __complete specs 2>/dev/null)
  _describe "spec" specs
}

# Get both changes and specs
_spok_complete_items() {
  local -a items
  while IFS=$'\\t' read -r id desc; do
    items+=("$id:$desc")
  done < <(spok __complete changes 2>/dev/null)
  while IFS=$'\\t' read -r id desc; do
    items+=("$id:$desc")
  done < <(spok __complete specs 2>/dev/null)
  _describe "item" items
}

# Use spok __complete to get available schemas
_spok_complete_schemas() {
  local -a schemas
  while IFS=$'\\t' read -r id desc; do
    schemas+=("$id:$desc")
  done < <(spok __complete schemas 2>/dev/null)
  _describe "schema" schemas
}`;
