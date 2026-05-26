#!/bin/bash

# Test script for postinstall.js
# Tests different scenarios: normal install, CI, opt-out

set -e

echo "======================================"
echo "Testing Spok Postinstall Script"
echo "======================================"
echo ""

# Save original environment
ORIGINAL_CI="${CI:-}"
ORIGINAL_SPOK_NO_INSTALL_TIP="${SPOK_NO_INSTALL_TIP:-}"

# Test 1: Normal install
echo "Test 1: Normal install (should print getting-started tip)"
echo "--------------------------------------"
unset CI
unset SPOK_NO_INSTALL_TIP
bun run scripts/postinstall.js
echo ""

# Test 2: CI environment (should skip silently)
echo "Test 2: CI=true (should skip silently)"
echo "--------------------------------------"
export CI=true
bun run scripts/postinstall.js
echo "[No output expected - skipped due to CI]"
echo ""

# Test 3: Opt-out flag (should skip silently)
echo "Test 3: SPOK_NO_INSTALL_TIP=1 (should skip silently)"
echo "--------------------------------------"
unset CI
export SPOK_NO_INSTALL_TIP=1
bun run scripts/postinstall.js
echo "[No output expected - skipped due to opt-out]"
echo ""

# Restore original environment
if [ -n "$ORIGINAL_CI" ]; then
  export CI="$ORIGINAL_CI"
else
  unset CI
fi

if [ -n "$ORIGINAL_SPOK_NO_INSTALL_TIP" ]; then
  export SPOK_NO_INSTALL_TIP="$ORIGINAL_SPOK_NO_INSTALL_TIP"
else
  unset SPOK_NO_INSTALL_TIP
fi

echo "======================================"
echo "All tests completed successfully!"
echo "======================================"
