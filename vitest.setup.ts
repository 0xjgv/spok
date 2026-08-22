import { ensureCliBuilt } from './test/helpers/run-cli.js';

// The pre-commit hook runs this suite from inside `git commit`, where git
// exports repo-pinning variables. Inherited by the temp git repos the tests
// (and the code under test) create, they retarget every git call at the real
// repository, so they must not survive into the workers.
for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_PREFIX']) {
  delete process.env[name];
}

// Ensure the CLI bundle exists before tests execute
export async function setup() {
  await ensureCliBuilt();
}

// Global teardown to ensure clean exit
export async function teardown() {
  // Force exit after a short grace period if the process hasn't exited cleanly.
  // This handles cases where child processes or open handles keep the worker alive.
  setTimeout(() => {
    process.exit(0);
  }, 1000).unref();
}
