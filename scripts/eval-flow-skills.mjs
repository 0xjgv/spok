#!/usr/bin/env node
/**
 * Opt-in evaluation of skill PROSE against the CLI's enforced gates.
 *
 * Deterministic tests can only check the CLI. They cannot see a rule written in
 * `assets/skills/**\/SKILL.md` that tells a model to do something the CLI then
 * refuses. The only way to surface that contradiction is to run the real
 * composed `step.prompt` through a real model against a real fixture repo and
 * check the CLI's verdict afterwards.
 *
 * Usage:
 *   node scripts/eval-flow-skills.mjs --dry-run       # compose, print, no model
 *   node scripts/eval-flow-skills.mjs --yes           # spend money, run the model
 *   node scripts/eval-flow-skills.mjs --yes --samples 3  # N runs; any failure fails
 *   SPOK_EVAL=1 node scripts/eval-flow-skills.mjs --runner codex --keep
 */

import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPOK_BIN = path.join(REPO_ROOT, 'bin', 'spok.js');

/** The chunk legitimately touches a workspace file under `spok/` — that is the point. */
const CHUNK_PATHS = ['spok/config.yaml', 'src/owned.ts'];

/** Minimal artifacts that satisfy each file-producing gate; verdicts must parse. */
const ARTIFACTS = {
  'validate-problem': '# Problem\n\n## Flow Decision\n\nproceed\n',
  'research-questions': '# Research Questions\n\n1. Does the commit gate accept workspace paths?\n',
  research: '# Research\n\nThe chunk edits one source file and one workspace file.\n',
  'design-discussion': '# Design Discussion\n\nNo contested decisions.\n',
  'structure-outline': '# Structure Outline\n\n## Phase 1\n\nEdit both chunk paths.\n',
  'design-review': '---\ntype: design-review\nverdict: PASS\n---\n# Design Review\n',
  plan: '# Plan\n\n## Phase 1\n\nEdit both chunk paths, then commit them together.\n',
  validate: '---\nverdict: PASS\n---\n# Validation\n\nBoth chunk paths changed as planned.\n',
};

function parseArgs(argv) {
  const opts = { runner: 'claude', model: undefined, keep: false, dryRun: false, yes: false, samples: 1 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--runner') opts.runner = argv[++i];
    else if (arg === '--model') opts.model = argv[++i];
    else if (arg === '--keep') opts.keep = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--samples') opts.samples = Math.max(1, Number(argv[++i]) || 1);
    else if (arg === '--yes') opts.yes = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!['claude', 'codex'].includes(opts.runner)) throw new Error(`Unknown runner: ${opts.runner}`);
  return opts;
}

/** Ambient Git overrides would silently retarget every child at the caller's checkout. */
function childEnv(extra = {}) {
  const env = { ...process.env, SPOK_TELEMETRY: '0', ...extra };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[key];
  return env;
}

async function git(root, args) {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { env: childEnv() });
  return stdout.trim();
}

/** A blocked gate exits non-zero but still prints its JSON verdict, and that verdict is the finding. */
async function spok(args, profile) {
  const result = await execFileAsync(process.execPath, [SPOK_BIN, ...args], {
    cwd: REPO_ROOT, env: childEnv({ SPOK_FLOW_PROFILE: profile }), maxBuffer: 32 * 1024 * 1024,
  }).catch((error) => error);
  const start = (result.stdout ?? '').indexOf('{');
  if (start === -1) throw new Error(`No JSON from spok ${args.join(' ')}: ${result.stderr || result.message}`);
  return JSON.parse(result.stdout.slice(start));
}

async function write(root, name, content) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function seedFixture() {
  const tempDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'spok-eval-')));
  const repo = path.join(tempDir, 'fixture');
  await fs.mkdir(repo);
  await git(repo, ['init', '-b', 'main']);
  for (const [key, value] of [['user.email', 'eval@example.com'], ['user.name', 'Spok Eval'],
    ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) {
    await git(repo, ['config', key, value]);
  }
  await write(repo, 'README.md', '# Fixture\n');
  await write(repo, 'spok/config.yaml', 'version: 1\nflow:\n  self_learn: false\n');
  await write(repo, 'src/kept.ts', 'export const kept = true;\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'Seed fixture']);
  const taskDir = path.join(repo, 'spok', 'changes', 'eval', '.flow', 'commit-planning-state');
  await write(taskDir, 'ticket.md',
    '# Ticket\n\nAdd `src/owned.ts` and record the chunk in `spok/config.yaml`.\n');
  return { tempDir, repo, taskDir };
}

/** Written only after `flow next` snapshots the baseline, or they count as pre-existing. */
async function editChunk(workRoot) {
  const config = path.join(workRoot, 'spok/config.yaml');
  const current = await fs.readFile(config, 'utf8');
  await fs.writeFile(config, `${current}chunk: commit-planning-state\n`);
  await write(workRoot, 'src/owned.ts', 'export const owned = true;\n');
}

async function complete(taskDir, args, profile) {
  const result = await spok(['flow', 'complete', taskDir, ...args, '--json'], profile);
  if (result.state === 'blocked') {
    throw new Error(`flow complete ${args[1]} blocked: ${result.reason}`);
  }
  return result;
}

/** `flow next` is the only source of truth for step order; never hardcode it. */
async function driveToCommit(taskDir, tempDir, profile) {
  for (let guard = 0; guard < 24; guard++) {
    const next = await spok(['flow', 'next', taskDir, '--json'], profile);
    if (next.state !== 'ready') throw new Error(`flow next -> ${next.state}: ${next.reason ?? ''}`);
    const step = next.step;
    if (step.id === 'commit') return { step, execution: next.execution };
    if (step.id === 'implement') {
      const workRoot = next.execution?.workRoot;
      if (!workRoot || !workRoot.startsWith(tempDir + path.sep)) {
        throw new Error(`Refusing to edit a work root outside the fixture: ${workRoot}`);
      }
      await editChunk(workRoot);
      await complete(taskDir, ['--step', 'implement', '--summary',
        'Added src/owned.ts and recorded the chunk in spok/config.yaml.',
        '--changed-path', ...CHUNK_PATHS], profile);
    } else if (ARTIFACTS[step.id]) {
      await fs.writeFile(step.expectedOutput, ARTIFACTS[step.id]);
      await complete(taskDir, ['--step', step.id], profile);
    } else {
      await complete(taskDir, ['--step', step.id, '--summary', `Eval stub for ${step.id}.`], profile);
    }
  }
  throw new Error('Flow never reached the commit step');
}

/** Flags come verbatim from assets/skills/spok-flow/SKILL.md section 1.4. */
function runnerArgv(runner, step, taskDir, workRoot, modelOverride) {
  const model = modelOverride ?? step.model;
  if (!model) throw new Error(`Step ${step.id} carries no model for runner ${runner}`);
  if (runner === 'codex') {
    return ['codex', ['exec', '--ephemeral', '--dangerously-bypass-hook-trust', '--cd', workRoot,
      '--model', model, '--sandbox', 'workspace-write', '--add-dir', taskDir,
      ...(step.effort ? ['-c', `model_reasoning_effort="${step.effort}"`] : []), '-']];
  }
  // Non-interactive `-p` cannot prompt, so unlisted Bash is denied and the
  // model reports a permission blocker instead of exercising the skill. Real
  // flows inherit the host session's permissions; the eval grants git only.
  return ['claude', ['-p', '--no-session-persistence', '--model', model,
    '--permission-mode', 'auto', '--allowedTools', 'Bash(git:*)', '--add-dir', taskDir,
    ...(step.effort ? ['--effort', step.effort] : [])]];
}

function dispatch(file, args, cwd, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
    child.stdin.end(prompt);
  });
}

/** Both chunk paths in one commit, and the CLI's own gate agreeing, is the whole claim. */
async function verify(taskDir, execution, profile) {
  const workRoot = execution.workRoot;
  const head = await git(workRoot, ['rev-parse', 'HEAD']);
  const advanced = await git(workRoot, ['rev-list', '--count', `${execution.baselineHead}..HEAD`]);
  const committed = (await git(workRoot,
    ['diff', '--no-renames', '--name-only', execution.baselineHead, 'HEAD'])).split('\n').filter(Boolean);
  const missing = CHUNK_PATHS.filter((file) => !committed.includes(file));
  const extra = committed.filter((file) => !CHUNK_PATHS.includes(file));
  const evidence = { head, commitsAdded: Number(advanced), committed, missing, extra };
  // The CLI's own wording is the finding, so ask for it even when Git already disagrees:
  // a partial commit is what a contradicting skill rule produces, and the gate names the path.
  try {
    const result = await spok(['flow', 'complete', taskDir, '--step', 'commit', '--commit', head,
      '--summary', 'Committed the chunk paths.', '--json'], profile);
    evidence.state = result.state;
    if (result.reason) evidence.reason = result.reason;
  } catch (error) {
    evidence.state = 'error';
    evidence.reason = error.message;
  }
  const gitAgrees = advanced === '1' && !missing.length && !extra.length;
  const cliAgrees = evidence.state !== 'blocked' && evidence.state !== 'error';
  if (gitAgrees && cliAgrees) {
    return { pass: true, reason: `CLI accepted the commit step (state: ${evidence.state}).`, evidence };
  }
  return { pass: false, evidence, reason: cliAgrees
    ? `Commit contents disagree with the chunk: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`
    : `CLI ${evidence.state} the commit step: ${evidence.reason}` };
}

// Claude Code and Codex merge the user's global skill catalog with the fixture's
// vendored one, and the global copy wins ties by name. CLAUDE_CONFIG_DIR isolation
// drops auth, so the only honest option is to refuse when a global copy drifts:
// otherwise the model runs stale prose and the verdict says nothing about assets/.
async function staleGlobalSkills(runner) {
  const home = os.homedir();
  const globalDir = path.join(home, runner === 'codex' ? '.agents' : '.claude', 'skills');
  const assetsDir = path.join(REPO_ROOT, 'assets', 'skills');
  const stale = [];
  for (const name of await fs.readdir(assetsDir)) {
    const shipped = path.join(assetsDir, name);
    const installed = path.join(globalDir, name);
    if (!(await fs.stat(installed).catch(() => null))) continue;
    for (const file of await listFiles(shipped)) {
      const rel = path.relative(shipped, file);
      const other = await fs.readFile(path.join(installed, rel)).catch(() => null);
      if (other === null || !other.equals(await fs.readFile(file))) { stale.push(name); break; }
    }
  }
  return stale;
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

async function main() {
  const opts = parseArgs(process.argv);
  const profile = opts.runner === 'codex' ? 'codex' : 'claude';
  const authorized = opts.yes || process.env.SPOK_EVAL === '1';
  if (!opts.dryRun && !authorized) {
    console.log([
      'scenario commit-planning-state: would build a temp fixture repo, drive the real CLI to the',
      `commit step, and dispatch the composed prompt to \`${opts.runner}\` (a real, billed model call).`,
      `The chunk edits ${CHUNK_PATHS.join(' and ')}; the eval then asserts HEAD advanced by one`,
      'commit containing BOTH paths and that `spok flow complete --step commit` is not blocked.',
      '',
      'Re-run with --yes (or SPOK_EVAL=1) to spend money, or --dry-run to see the composed prompt.',
    ].join('\n'));
    return 0;
  }

  const stale = await staleGlobalSkills(opts.runner);
  if (stale.length > 0) {
    console.log(`FAIL precondition: global skill catalog drifts from assets/skills for ${JSON.stringify(stale)}.`);
    console.log('Run `spok skills install --tools claude,codex --force` so the model reads the prose under test.');
    return 1;
  }

  // A model can ignore contradictory prose on one sample and obey it on the next
  // (observed 1 refusal in 3 with the commit step's routed model). Sample N times
  // and fail on any failure; a single green run is not evidence of consistency.
  let failures = 0;
  for (let sample = 1; sample <= opts.samples; sample++) {
    if (opts.samples > 1) console.log(`\n===== sample ${sample}/${opts.samples} =====`);
    if ((await runOnce(opts, profile)) !== 0) failures++;
    if (opts.dryRun) break;
  }
  if (opts.samples > 1 && !opts.dryRun) console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} ${opts.samples - failures}/${opts.samples} samples passed`);
  return failures === 0 ? 0 : 1;
}

async function runOnce(opts, profile) {
  const { tempDir, repo, taskDir } = await seedFixture();
  let outcome = 1;
  try {
    console.log(`fixture: ${repo}`);
    const { step, execution } = await driveToCommit(taskDir, tempDir, profile);
    const [file, args] = runnerArgv(opts.runner, step, taskDir, execution.workRoot, opts.model);
    console.log(`work root: ${execution.workRoot}`);
    console.log(`baseline HEAD: ${execution.baselineHead}`);
    console.log(`allowlist: ${JSON.stringify(execution.ownedPaths)}`);
    console.log(`argv: ${JSON.stringify([file, ...args])}`);
    console.log(`\n----- composed step.prompt (${step.id}) -----\n${step.prompt}\n----- end prompt -----\n`);
    if (opts.dryRun) {
      console.log('DRY RUN: no model was called.');
      outcome = 0;
      return outcome;
    }
    const { code, stdout } = await dispatch(file, args, execution.workRoot, step.prompt);
    console.log(`\n----- ${file} exit ${code} -----\n${stdout.trim().split('\n').slice(-20).join('\n')}\n`);
    const result = await verify(taskDir, execution, profile);
    console.log(`evidence: ${JSON.stringify(result.evidence, null, 2)}`);
    console.log(`${result.pass ? 'PASS' : 'FAIL'} commit-planning-state: ${result.reason}`);
    outcome = result.pass ? 0 : 1;
  } catch (error) {
    console.log(`FAIL commit-planning-state: ${error.message}`);
  } finally {
    if (opts.keep) console.log(`kept fixture: ${tempDir}`);
    else await fs.rm(tempDir, { recursive: true, force: true });
  }
  return outcome;
}

process.exitCode = await main();
