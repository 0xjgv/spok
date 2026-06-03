#!/usr/bin/env bun
/**
 * Pre-flight check runner + development tasks. Zero dependencies — Bun APIs only.
 *
 * Usage:
 *   bun harness.ts                  # full pre-flight (default)
 *   bun harness.ts check            # full pre-flight
 *   bun harness.ts fix              # fix lint errors + format
 *   bun harness.ts pre-commit       # staged checks + tests
 *   bun harness.ts ci               # CI verification
 *   bun harness.ts acceptance       # cucumber scenarios
 *   bun harness.ts coverage --min=N # tests with coverage threshold
 *   bun harness.ts mutation         # Stryker mutation testing (advisory)
 *   bun harness.ts crap --max=N     # CRAP complexity x coverage (advisory)
 *   bun harness.ts arch             # dependency-cruiser arch checks
 *   bun harness.ts --verbose        # show all output
 */

// ── Configuration ───────────────────────────────────────────────────

const SRC_DIR = 'src';
const TEST_DIR = 'test';
const ROOT = import.meta.dir;
const COMPLEXITY_BASELINE = 'complexity-baseline.json';

const COMPLEXITY_LIMITS = {
  nloc: 1_000_000,
  ccn: 15,
  params: 7,
  length: 100,
} as const;

// ── Output ──────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const VERBOSE = process.argv.includes('--verbose');

// ── Runner ──────────────────────────────────────────────────────────

interface RunResult {
  ok: boolean;
  output: string;
}

interface ComplexityOffender {
  location: string;
  nloc: number;
  ccn: number;
  params: number;
  length: number;
}

async function run(
  description: string,
  cmd: string[],
  opts?: { extract?: (output: string) => string | undefined; noExit?: boolean },
): Promise<RunResult> {
  if (VERBOSE) console.log(`${DIM}  → ${cmd.join(' ')}${RESET}`);

  const proc = Bun.spawn(cmd, { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  const output = stdout + stderr;

  if (VERBOSE && output.trim()) console.log(output);

  if (exitCode === 0) {
    const detail = opts?.extract?.(output);
    const suffix = detail ? ` ${DIM}(${detail})${RESET}` : '';
    console.log(`  ${GREEN}✓${RESET} ${description}${suffix}`);
    return { ok: true, output };
  }

  console.log(`  ${RED}✗${RESET} ${description}`);
  if (!VERBOSE && output.trim()) console.log(output);
  if (!opts?.noExit) process.exit(exitCode);
  return { ok: false, output };
}

// ── Extractors ──────────────────────────────────────────────────────

function extractTscSummary(output: string): string | undefined {
  if (!output.trim()) return 'no errors';
  const errors = output.match(/Found (\d+) errors?/)?.[1];
  if (errors) return `${errors} errors`;
}

function extractTestSummary(output: string): string | undefined {
  const pass = output.match(/(\d+) passed/)?.[1];
  const fail = output.match(/(\d+) failed/)?.[1];
  if (pass) {
    const parts = [`${pass} passed`];
    if (fail && fail !== '0') parts.push(`${fail} failed`);
    return parts.join(', ');
  }
}

// ── Suppressions ────────────────────────────────────────────────────

export interface SuppressionMatch {
  kind: string;
  rules: string[];
}

const TS_DIRECTIVE_PATTERNS: { kind: string; pattern: RegExp }[] = [
  { kind: 'ts-ignore', pattern: /\/\/\s*@ts-ignore\b/ },
  { kind: 'ts-expect-error', pattern: /\/\/\s*@ts-expect-error\b/ },
  { kind: 'ts-nocheck', pattern: /\/\/\s*@ts-nocheck\b/ },
];
const ESLINT_PATTERN =
  /(?:\/\/|\/\*)\s*eslint-disable(?:-line|-next-line)?(?::\s*([^*\n]+?))?(?:\s*\*\/|\s*$)/;
const BIOME_PATTERN = /\/\/\s*biome-ignore\s+([a-zA-Z0-9_/-]+)/;

export function parseLineForSuppressions(line: string): SuppressionMatch[] {
  const out: SuppressionMatch[] = [];
  for (const d of TS_DIRECTIVE_PATTERNS) {
    if (d.pattern.test(line)) out.push({ kind: d.kind, rules: [] });
  }
  const em = ESLINT_PATTERN.exec(line);
  if (em) {
    const rules = em[1]
      ? em[1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    out.push({ kind: 'eslint-disable', rules });
  }
  const bm = BIOME_PATTERN.exec(line);
  if (bm) {
    out.push({ kind: 'biome-ignore', rules: [bm[1]] });
  }
  return out;
}

export async function scanSuppressions(roots?: string[]): Promise<Record<string, string[][]>> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const actualRoots = roots ?? [SRC_DIR, TEST_DIR].map((d) => join(ROOT, d));
  const results: Record<string, string[][]> = {};

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) return;
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.endsWith('.ts')) {
        const text = await readFile(full, 'utf8').catch(() => null);
        if (text == null) continue;
        for (const line of text.split('\n')) {
          for (const m of parseLineForSuppressions(line)) {
            const bucket = results[m.kind] ?? [];
            bucket.push(m.rules);
            results[m.kind] = bucket;
          }
        }
      }
    }
  }

  for (const dir of actualRoots) {
    await walk(dir);
  }
  return results;
}

async function printSuppressionsReport(): Promise<void> {
  const results = await scanSuppressions();
  const total = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
  console.log('\n=== Suppressions ===\n');
  console.log(`Suppressions: ${total} total`);
  if (total === 0) return;
  for (const kind of Object.keys(results).sort()) {
    const entries = results[kind];
    console.log(`  ${kind}: ${entries.length}`);
    const ruleCounts: Record<string, number> = {};
    for (const rules of entries) {
      for (const r of rules) {
        ruleCounts[r] = (ruleCounts[r] ?? 0) + 1;
      }
    }
    const sorted = Object.entries(ruleCounts).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    for (const [rule, count] of sorted.slice(0, 10)) {
      console.log(`    ${rule}: ${count}`);
    }
  }
}

// ── Git helpers ─────────────────────────────────────────────────────

async function stagedTsFiles(): Promise<string[]> {
  const proc = Bun.spawn(
    ['git', 'diff', '--cached', '--name-only', '--diff-filter=d', '--relative'],
    {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout
    .trim()
    .split('\n')
    .filter(
      (f) => f.endsWith('.ts') && (f.startsWith(`${SRC_DIR}/`) || f.startsWith(`${TEST_DIR}/`)),
    );
}

async function changedTsFiles(): Promise<string[]> {
  const proc = Bun.spawn(['git', 'status', '--porcelain'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout
    .trim()
    .split('\n')
    .map((line) => line.slice(3))
    .filter(
      (f) => f.endsWith('.ts') && (f.startsWith(`${SRC_DIR}/`) || f.startsWith(`${TEST_DIR}/`)),
    );
}

// ── Commands ────────────────────────────────────────────────────────

async function cmdFix(files?: string[]): Promise<void> {
  const lintable = (files ?? [`${SRC_DIR}/`]).filter((f) => f.startsWith(`${SRC_DIR}/`));
  if (lintable.length === 0) return;
  await run('Fix lint', ['bunx', 'eslint', '--fix', ...lintable]);
}

async function cmdLint(): Promise<void> {
  await run('Lint check', ['bunx', 'eslint', `${SRC_DIR}/`]);
}

async function cmdBuild(): Promise<void> {
  await run('Build', ['bun', 'run', 'build']);
}

async function cmdTypecheck(): Promise<void> {
  await run('Typecheck', ['bunx', 'tsc', '--noEmit'], { extract: extractTscSummary });
}

async function cmdTest(): Promise<void> {
  await run('Tests', ['bunx', 'vitest', 'run'], { extract: extractTestSummary });
}

async function cmdAudit(): Promise<void> {
  await run('Dep audit', ['bun', 'audit']);
}

async function cmdCoverage(): Promise<void> {
  // Bun's test runner has no built-in per-percentage gate; we emit LCOV and
  // compute the line-coverage percentage ourselves, mirroring python's --min=N.
  const minArg = process.argv.find((a) => a.startsWith('--min='));
  const minPct = minArg ? Number(minArg.split('=', 2)[1]) : 0;

  await run('Coverage (run)', [
    'bunx',
    'vitest',
    'run',
    '--coverage',
    '--coverage.reporter=lcov',
    '--coverage.reportsDirectory=coverage',
  ]);

  const { readFile } = await import('node:fs/promises');
  const lcov = await readFile(`${ROOT}/coverage/lcov.info`, 'utf8').catch(() => null);
  if (lcov == null) {
    console.log(`  ${RED}✗${RESET} Coverage: coverage/lcov.info not found`);
    process.exit(1);
  }
  let found = 0;
  let hit = 0;
  for (const line of lcov.split('\n')) {
    if (line.startsWith('LF:')) found += Number(line.slice(3));
    else if (line.startsWith('LH:')) hit += Number(line.slice(3));
  }
  const pct = found === 0 ? 100 : (hit / found) * 100;
  if (pct >= minPct) {
    console.log(`  ${GREEN}✓${RESET} Coverage >= ${minPct}% ${DIM}(${pct.toFixed(1)}%)${RESET}`);
  } else {
    console.log(`  ${RED}✗${RESET} Coverage >= ${minPct}% ${DIM}(got ${pct.toFixed(1)}%)${RESET}`);
    process.exit(1);
  }
}

async function cmdAcceptance(): Promise<void> {
  // Run cucumber-js scenarios. Empty/absent features dir warns + exits 0.
  const { existsSync } = await import('node:fs');
  const featuresDir = `${ROOT}/${TEST_DIR}/features`;
  let hasFeature = false;
  if (existsSync(featuresDir)) {
    const glob = new Bun.Glob('**/*.feature');
    const matches = await Array.fromAsync(glob.scan({ cwd: featuresDir, onlyFiles: true }));
    hasFeature = matches.length > 0;
  }
  if (!hasFeature) {
    console.log(
      `  ${GREEN}⚠${RESET} Acceptance: no .feature files in ${TEST_DIR}/features/ ` +
        '(add one to enable this gate)',
    );
    return;
  }
  // cucumber-js runs on Node; invoking its bin through the Bun runtime lets
  // TypeScript step definitions resolve without a separate loader.
  await run('Acceptance (cucumber)', ['bun', './node_modules/@cucumber/cucumber/bin/cucumber.js']);
}

async function cmdArch(): Promise<void> {
  // Import/dependency-boundary linter via dependency-cruiser.
  const { existsSync } = await import('node:fs');
  if (!existsSync(`${ROOT}/.dependency-cruiser.json`)) {
    console.log(`  ${GREEN}⚠${RESET} Arch: no .dependency-cruiser.json — skipped`);
    return;
  }
  await run('Arch (dependency-cruiser)', [
    './node_modules/.bin/depcruise',
    '--config',
    '.dependency-cruiser.json',
    '--no-progress',
    `${SRC_DIR}/**/*.ts`,
  ]);
}

async function cmdMutation(): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (!existsSync(`${ROOT}/stryker.conf.json`)) {
    console.log(`  ${GREEN}⚠${RESET} Mutation: no stryker.conf.json — skipped`);
    return;
  }
  await run('Mutation (Stryker)', ['./node_modules/.bin/stryker', 'run'], { noExit: true });
}

interface CrapFn {
  crap: number;
  ccn: number;
  cov: number;
  loc: string;
}

export function crapScore(ccn: number, cov: number): number {
  return ccn * ccn * (1 - cov) ** 3 + ccn;
}

export function parseLcov(text: string): Record<string, Record<number, number>> {
  const covMap: Record<string, Record<number, number>> = {};
  let curFile = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('SF:')) {
      curFile = line.slice(3).trim();
      // Merge into existing entry: LCOV may carry two SF blocks for the same
      // path (sharded runs, hand-merged reports). Overwriting would drop the
      // first block's DA entries.
      covMap[curFile] ??= {};
    } else if (line.startsWith('DA:') && curFile) {
      const [num, hits] = line.slice(3).split(',');
      covMap[curFile][Number(num)] = Number(hits);
    } else if (line.startsWith('end_of_record')) {
      curFile = '';
    }
  }
  return covMap;
}

async function cmdCrap(): Promise<void> {
  // CRAP = ccn^2 * (1-cov)^3 + ccn per function. Advisory — lizard + LCOV.
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxCrap = maxArg ? Number(maxArg.split('=', 2)[1]) : 30;
  const changedOnly = process.argv.includes('--changed-only');
  const enforce = process.argv.includes('--enforce');

  const { readFile } = await import('node:fs/promises');
  const lcov = await readFile(`${ROOT}/coverage/lcov.info`, 'utf8').catch(() => null);
  if (lcov == null) {
    console.log(
      `  ${RED}✗${RESET} CRAP: coverage/lcov.info not found — run \`harness coverage\` first`,
    );
    process.exit(1);
  }

  // Parse LCOV into { file: { lineNumber: hits } }.
  const covMap = parseLcov(lcov);

  let changed: Set<string> | null = null;
  if (changedOnly) {
    const proc = Bun.spawn(['git', 'diff', '--name-only', 'origin/main...HEAD'], {
      cwd: ROOT,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    changed = new Set(
      out
        .split('\n')
        .map((f) => f.trim())
        .filter((f) => f.endsWith('.ts')),
    );
  }

  // lizard --csv columns: nloc,ccn,token,param,length,location,file,name,sig,start,end
  const lz = Bun.spawn(['uvx', 'lizard@1.22.2', SRC_DIR, '--csv'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [lzOut, lzErr, lzCode] = await Promise.all([
    new Response(lz.stdout).text(),
    new Response(lz.stderr).text(),
    lz.exited,
  ]);
  if (lzCode !== 0) {
    // Lizard could not run (uvx missing, network failure, lizard crash).
    // Reporting "all functions below max" here would be a silent false-pass.
    console.log(
      `  ${RED}✗${RESET} CRAP: lizard failed to run (exit ${lzCode})` +
        `${enforce ? '' : ' (advisory)'}`,
    );
    if (lzErr.trim()) console.log(lzErr.trim());
    if (enforce) process.exit(lzCode);
    return;
  }

  // lizard --csv: column 1 is CCN; the quoted location field encodes
  // `name@start-end@path`. Signatures can contain commas, so derive the
  // location (and thus path/start/end) from that self-contained field.
  // Name may be empty for anonymous arrows/IIFEs — match but skip cleanly.
  const locRe = /"([^"@]*)@(\d+)-(\d+)@([^"]+)"/;
  const offenders: CrapFn[] = [];
  for (const row of lzOut.split('\n')) {
    const cols = row.split(',');
    if (cols.length < 11) continue;
    const ccn = Number(cols[1]);
    if (!Number.isFinite(ccn)) continue;
    const lm = locRe.exec(row);
    if (!lm) continue;
    const [, name, startS, endS, path] = lm;
    // Anonymous functions: lizard emits an empty name. They share their
    // parent's coverage attribution in LCOV, so a per-function join cannot
    // score them fairly — skip rather than silently misattribute.
    if (!name) continue;
    const start = Number(startS);
    const end = Number(endS);
    const location = `${name}@${start}-${end}@${path}`;
    if (changed !== null && !changed.has(path)) continue;

    const lines = covMap[path] ?? covMap[path.replace(/^\.\//, '')] ?? {};
    const inRange: number[] = [];
    for (let n = start; n <= end; n++) {
      if (n in lines) inRange.push(n);
    }
    const cov = inRange.length ? inRange.filter((n) => lines[n] > 0).length / inRange.length : 0;
    const crap = crapScore(ccn, cov);
    if (crap > maxCrap) {
      offenders.push({ crap, ccn, cov, loc: location });
    }
  }

  if (offenders.length === 0) {
    console.log(`  ${GREEN}✓${RESET} CRAP: all functions below ${maxCrap}`);
    return;
  }
  offenders.sort((a, b) => b.crap - a.crap);
  const suffix = enforce ? '' : ' (advisory)';
  console.log(
    `  ${RED}✗${RESET} CRAP: ${offenders.length} function(s) exceed ${maxCrap}${suffix}`,
  );
  for (const o of offenders.slice(0, 20)) {
    console.log(
      `    CRAP=${o.crap.toFixed(1).padStart(6)}  CCN=${String(o.ccn).padStart(3)}  ` +
        `cov=${(o.cov * 100).toFixed(1).padStart(5)}%  ${o.loc}`,
    );
  }
  if (enforce) process.exit(1);
}

function parseLizardComplexityOffenders(output: string): ComplexityOffender[] {
  const locRe = /"([^"@]*)@(\d+)-(\d+)@([^"]+)"/;
  const offenders: ComplexityOffender[] = [];

  for (const row of output.split('\n')) {
    const cols = row.split(',');
    if (cols.length < 11) continue;

    const nloc = Number(cols[0]);
    const ccn = Number(cols[1]);
    const params = Number(cols[3]);
    const length = Number(cols[4]);
    if (![nloc, ccn, params, length].every(Number.isFinite)) continue;

    const isOffender =
      nloc > COMPLEXITY_LIMITS.nloc ||
      ccn > COMPLEXITY_LIMITS.ccn ||
      params > COMPLEXITY_LIMITS.params ||
      length > COMPLEXITY_LIMITS.length;
    if (!isOffender) continue;

    const match = locRe.exec(row);
    if (!match) continue;

    const [, name, start, end, file] = match;
    offenders.push({
      location: `${name}@${start}-${end}@${file}`,
      nloc,
      ccn,
      params,
      length,
    });
  }

  return offenders.sort((a, b) => a.location.localeCompare(b.location));
}

async function readComplexityBaseline(): Promise<Set<string>> {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(`${ROOT}/${COMPLEXITY_BASELINE}`, 'utf8').catch(() => null);
  if (raw == null) return new Set();

  const parsed = JSON.parse(raw) as { offenders?: unknown };
  if (!Array.isArray(parsed.offenders)) {
    throw new Error(`${COMPLEXITY_BASELINE} must contain an offenders array`);
  }

  return new Set(parsed.offenders.filter((entry): entry is string => typeof entry === 'string'));
}

function printComplexityOffender(offender: ComplexityOffender): void {
  console.log(
    `    CCN=${String(offender.ccn).padStart(3)}  PARAM=${String(offender.params).padStart(2)}  ` +
      `LEN=${String(offender.length).padStart(4)}  ${offender.location}`,
  );
}

async function cmdComplexity(): Promise<void> {
  const lz = Bun.spawn(['uvx', 'lizard@1.22.2', SRC_DIR, TEST_DIR, '--csv'], {
    cwd: ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(lz.stdout).text(),
    new Response(lz.stderr).text(),
    lz.exited,
  ]);

  if (code !== 0) {
    console.log(`  ${RED}✗${RESET} Complexity (lizard)`);
    if (stderr.trim()) console.log(stderr.trim());
    process.exit(code);
  }

  const baseline = await readComplexityBaseline();
  const offenders = parseLizardComplexityOffenders(stdout);
  const unbaselined = offenders.filter((offender) => !baseline.has(offender.location));

  if (unbaselined.length === 0) {
    const suffix = offenders.length === 0 ? '' : ` ${DIM}(${offenders.length} baseline)${RESET}`;
    console.log(`  ${GREEN}✓${RESET} Complexity (lizard)${suffix}`);
    return;
  }

  console.log(
    `  ${RED}✗${RESET} Complexity (lizard): ${unbaselined.length} unbaselined offender(s)`,
  );
  for (const offender of unbaselined.slice(0, 20)) {
    printComplexityOffender(offender);
  }
  if (unbaselined.length > 20) {
    console.log(`    ... ${unbaselined.length - 20} more`);
  }
  process.exit(1);
}

async function cmdPostEdit(): Promise<void> {
  const files = (await changedTsFiles()).filter((f) => f.startsWith(`${SRC_DIR}/`));
  if (files.length === 0) return;
  await run('Fix lint', ['bunx', 'eslint', '--fix', ...files], { noExit: true });
}

// ── Stages ──────────────────────────────────────────────────────────

async function checkHooksPresent(): Promise<void> {
  const { existsSync } = await import('node:fs');
  const settingsPath = `${ROOT}/.claude/settings.json`;
  if (!existsSync(settingsPath)) return;
  const settings = JSON.parse(await Bun.file(settingsPath).text()) as {
    hooks?: { SessionStart?: unknown[] };
  };
  if (!settings.hooks?.SessionStart?.length) return;

  const required = [
    '.claude/scripts/session-start.sh',
    '.claude/scripts/ups-classify.sh',
    '.claude/scripts/pre-bash-gate.sh',
    '.claude/scripts/pre-edit-gate.sh',
  ];
  const missing = required.filter((p) => !existsSync(`${ROOT}/${p}`));
  if (missing.length > 0) {
    console.log(`  ${RED}⚠${RESET} Missing hook scripts: ${missing.join(', ')}`);
  }
}

function firstDiffLine(a: string, b: string): number {
  const al = a.split('\n');
  const bl = b.split('\n');
  const len = Math.min(al.length, bl.length);
  for (let i = 0; i < len; i++) {
    if (al[i] !== bl[i]) return i + 1;
  }
  return len + 1;
}

async function checkAgentsMdDrift(noExit = false): Promise<RunResult> {
  const { existsSync, readFileSync } = await import('node:fs');
  const claudePath = `${ROOT}/CLAUDE.md`;
  const agentsPath = `${ROOT}/AGENTS.md`;
  const fail = (msg: string): RunResult => {
    console.log(`  ${RED}✗${RESET} agents-md-drift: ${msg}`);
    if (!noExit) process.exit(1);
    return { ok: false, output: msg };
  };
  if (!existsSync(claudePath)) return fail('CLAUDE.md not found');
  if (!existsSync(agentsPath)) {
    return fail('AGENTS.md missing — run `harness sync-agents-md`');
  }
  const a = readFileSync(claudePath);
  const b = readFileSync(agentsPath);
  if (a.equals(b)) {
    console.log(`  ${GREEN}✓${RESET} agents-md-drift`);
    return { ok: true, output: '' };
  }
  const line = firstDiffLine(a.toString('utf8'), b.toString('utf8'));
  return fail(
    `AGENTS.md differs from CLAUDE.md (first diff at line ${line}) — ` +
      'run `harness sync-agents-md`',
  );
}

async function cmdSyncAgentsMd(): Promise<void> {
  const { existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const claudePath = `${ROOT}/CLAUDE.md`;
  if (!existsSync(claudePath)) {
    console.log(`  ${RED}✗${RESET} sync-agents-md: CLAUDE.md not found`);
    process.exit(1);
  }
  writeFileSync(`${ROOT}/AGENTS.md`, readFileSync(claudePath));
  console.log(`  ${GREEN}✓${RESET} sync-agents-md: AGENTS.md ← CLAUDE.md`);
}

async function cmdAgentsMdDrift(): Promise<void> {
  await checkAgentsMdDrift();
}

async function cmdCheck(): Promise<void> {
  const start = performance.now();
  console.log(`\n${BLUE}[check]${RESET} Running pre-flight checks...\n`);

  const results: RunResult[] = [];
  results.push(
    await run('Lockfile sync', ['bun', 'install', '--frozen-lockfile'], { noExit: true }),
  );
  results.push(await run('Fix lint', ['bunx', 'eslint', '--fix', `${SRC_DIR}/`], { noExit: true }));
  results.push(await run('Build', ['bun', 'run', 'build'], { noExit: true }));
  results.push(
    await run('Typecheck', ['bunx', 'tsc', '--noEmit'], {
      extract: extractTscSummary,
      noExit: true,
    }),
  );
  results.push(
    await run('Tests', ['bunx', 'vitest', 'run'], { extract: extractTestSummary, noExit: true }),
  );

  await checkHooksPresent();
  results.push(await checkAgentsMdDrift(true));
  await printSuppressionsReport();

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  console.log();
  if (failed > 0) {
    console.log(
      `${RED}FAIL${RESET} ${passed} passed, ${failed} failed ${DIM}(${elapsed}s)${RESET}`,
    );
    process.exit(1);
  } else {
    console.log(`${GREEN}OK${RESET} ${passed} passed ${DIM}(${elapsed}s)${RESET}`);
  }
}

async function cmdPreCommit(): Promise<void> {
  const files = await stagedTsFiles();
  if (files.length === 0) {
    console.log('No staged TypeScript files — skipping checks');
    return;
  }

  console.log(`\n${BLUE}[pre-commit]${RESET}\n`);
  await cmdFix(files);
  await cmdTypecheck();
  await checkAgentsMdDrift();

  if (files.some((f) => f.startsWith(`${SRC_DIR}/`))) {
    await cmdTest();
  }
}

async function cmdCi(): Promise<void> {
  console.log(`\n${BLUE}[ci]${RESET}\n`);
  await cmdLint();
  await cmdTypecheck();
  await cmdBuild();
  await cmdAudit();
  await cmdComplexity();
  await cmdAcceptance();
  await cmdCoverage();
  await cmdCrap();
  await cmdArch();
}

async function cmdHooks(): Promise<void> {
  const hookPath = `${ROOT}/.git/hooks/pre-commit`;
  const hookDir = `${ROOT}/.git/hooks`;

  const { mkdirSync, writeFileSync, chmodSync } = await import('node:fs');
  mkdirSync(hookDir, { recursive: true });
  writeFileSync(hookPath, '#!/bin/sh\nbun harness.ts pre-commit\n');
  chmodSync(hookPath, 0o755);
  console.log('Installed pre-commit hook');
}

async function cmdClean(): Promise<void> {
  console.log(`\n${BLUE}[clean]${RESET}\n`);
  const { rmSync, existsSync } = await import('node:fs');
  for (const name of ['node_modules/.cache', 'coverage']) {
    if (existsSync(`${ROOT}/${name}`)) {
      rmSync(`${ROOT}/${name}`, { recursive: true });
      console.log(`  ${GREEN}✓${RESET} Removed ${name}`);
    }
  }
  const glob = new Bun.Glob('**/*.tsbuildinfo');
  for await (const path of glob.scan({ cwd: ROOT })) {
    rmSync(`${ROOT}/${path}`);
    console.log(`  ${GREEN}✓${RESET} Removed ${path}`);
  }
}

// ── CLI dispatch ────────────────────────────────────────────────────

const TASKS: Record<string, [(() => Promise<void>) | ((f?: string[]) => Promise<void>), string]> = {
  fix: [cmdFix, 'Fix lint errors (eslint --fix)'],
  lint: [cmdLint, 'Lint check (read-only)'],
  build: [cmdBuild, 'Build dist via tsc'],
  typecheck: [cmdTypecheck, 'Type-check with tsc'],
  test: [cmdTest, 'Run tests'],
  audit: [cmdAudit, 'Audit dependencies for known vulnerabilities'],
  acceptance: [cmdAcceptance, 'Run acceptance scenarios (cucumber)'],
  coverage: [cmdCoverage, 'Tests with coverage threshold (--min=N)'],
  mutation: [cmdMutation, 'Mutation testing (Stryker, advisory)'],
  crap: [cmdCrap, 'CRAP complexity x coverage gate (advisory)'],
  complexity: [cmdComplexity, 'Cyclomatic complexity gate (lizard, CCN 15)'],
  arch: [cmdArch, 'Architecture checks (dependency-cruiser)'],
  check: [cmdCheck, 'Full pre-flight: lockfile + fix + build + typecheck + tests'],
  'pre-commit': [cmdPreCommit, 'Staged checks + tests'],
  ci: [cmdCi, 'Lint + typecheck + build + audit + complexity + acceptance + coverage + crap + arch'],
  'setup-hooks': [cmdHooks, 'Install git pre-commit hook'],
  'post-edit': [cmdPostEdit, 'Format if source files changed (Claude Code hook)'],
  'agents-md-drift': [cmdAgentsMdDrift, 'Fail if AGENTS.md differs from CLAUDE.md'],
  'sync-agents-md': [cmdSyncAgentsMd, 'Overwrite AGENTS.md from CLAUDE.md'],
  clean: [cmdClean, 'Remove caches and build artifacts'],
};

if (import.meta.main) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const taskName = args[0];

  if (taskName && !(taskName in TASKS)) {
    console.error(`Unknown command: ${taskName}`);
    process.exit(1);
  }

  if (taskName) {
    await TASKS[taskName][0]();
  } else {
    await cmdCheck();
  }
}
