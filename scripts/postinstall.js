#!/usr/bin/env bun

/**
 * Postinstall script that prints a one-line getting-started hint.
 *
 * The tip is suppressed when:
 * - CI=true environment variable is set
 * - SPOK_NO_INSTALL_TIP=1 environment variable is set
 * - dist/ directory doesn't exist (dev setup scenario)
 *
 * The script never fails install - all errors are caught and handled gracefully.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Check if we should skip the install tip
 */
function shouldSkipTip() {
  if (process.env.CI === 'true' || process.env.CI === '1') {
    return { skip: true, reason: 'CI environment detected' };
  }

  if (process.env.SPOK_NO_INSTALL_TIP === '1' || process.env.SPOK_NO_COMPLETIONS === '1') {
    return { skip: true, reason: 'opt-out env var set' };
  }

  return { skip: false };
}

/**
 * Check if dist/ directory exists
 */
async function distExists() {
  const distPath = path.join(__dirname, '..', 'dist');
  try {
    const stat = await fs.stat(distPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    const skipCheck = shouldSkipTip();
    if (skipCheck.skip) {
      return;
    }

    if (!(await distExists())) {
      return;
    }

    console.log(`\nTip: Run 'spok init' in your project directory to get started`);
  } catch {
    // Fail gracefully - never break install
  }
}

main().catch(() => {
  process.exit(0);
});
