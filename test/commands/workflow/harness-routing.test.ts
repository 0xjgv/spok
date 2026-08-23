import { describe, expect, it } from 'vitest';

import {
  AUTO_POLICY_VERSION,
  AUTO_V1_CANDIDATES_BY_ID,
  DEFAULT_PROBE_TIMEOUT_MS,
  probeHarnesses,
  selectAutoRoute,
  type CapabilityReport,
  type ProbeExec,
} from '../../../src/commands/workflow/harness-routing.js';

const OMP_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

type ExecResult = { stdout: string; stderr: string };

function fakeExec(byFile: Record<string, () => Promise<ExecResult>>) {
  const calls: Array<{ file: string; args: readonly string[]; timeout: number }> = [];
  const exec: ProbeExec = async (file, args, options) => {
    calls.push({ file, args, timeout: options.timeout });
    const handler = byFile[file];
    if (!handler) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT' });
    return handler();
  };
  return { exec, calls };
}

const ok = (stdout: string, stderr = '') => async (): Promise<ExecResult> => ({ stdout, stderr });
const fail = (props: Record<string, unknown>) => async (): Promise<ExecResult> => {
  throw Object.assign(new Error('Command failed'), props);
};

const OMP_MODELS_JSON = JSON.stringify({
  models: [
    {
      provider: 'openai-codex',
      id: 'gpt-5.6-sol',
      selector: 'openai-codex/gpt-5.6-sol',
      thinking: OMP_EFFORTS,
    },
    {
      provider: 'openai-codex',
      id: 'gpt-5.6-terra',
      selector: 'openai-codex/gpt-5.6-terra',
      thinking: OMP_EFFORTS,
    },
    { provider: 'anthropic', id: 'claude-haiku', selector: 'anthropic/claude-haiku', thinking: [] },
  ],
});

function ompReport(models: Array<[string, string[]]>): CapabilityReport {
  return { runner: 'omp', available: true, models: new Map(models) };
}

function allAvailable(): CapabilityReport[] {
  return [
    { runner: 'codex', available: true },
    ompReport([
      ['openai-codex/gpt-5.6-sol', OMP_EFFORTS],
      ['openai-codex/gpt-5.6-terra', OMP_EFFORTS],
    ]),
    { runner: 'claude', available: true },
  ];
}

describe('AUTO_V1_CANDIDATES_BY_ID', () => {
  it('matches the reviewed auto-v1 table', () => {
    expect(AUTO_POLICY_VERSION).toBe('auto-v1');
    expect(AUTO_V1_CANDIDATES_BY_ID).toEqual({
      'validate-problem': [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'claude', model: 'opus', effort: 'medium' },
      ],
      'research-questions': [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'medium' },
        { runner: 'claude', model: 'opus', effort: 'medium' },
      ],
      research: [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'medium' },
        { runner: 'claude', model: 'sonnet', effort: 'medium' },
      ],
      'design-discussion': [
        { runner: 'claude', model: 'fable', effort: 'xhigh' },
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'max' },
      ],
      'structure-outline': [
        { runner: 'claude', model: 'fable', effort: 'xhigh' },
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
      ],
      'design-review': [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'claude', model: 'opus', effort: 'medium' },
      ],
      plan: [
        { runner: 'claude', model: 'fable', effort: 'xhigh' },
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'max' },
      ],
      implement: [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'claude', model: 'opus', effort: 'medium' },
      ],
      simplify: [
        { runner: 'claude', model: 'opus' },
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
      ],
      validate: [
        { runner: 'claude', model: 'opus', effort: 'medium' },
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'xhigh' },
      ],
      repair: [
        { runner: 'codex', model: 'gpt-5.6-sol', effort: 'max' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-sol', effort: 'max' },
        { runner: 'claude', model: 'opus', effort: 'high' },
      ],
      commit: [
        { runner: 'codex', model: 'gpt-5.6-terra', effort: 'low' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-terra', effort: 'low' },
        { runner: 'claude', model: 'haiku', effort: 'low' },
      ],
      'self-learn': [
        { runner: 'codex', model: 'gpt-5.6-terra', effort: 'xhigh' },
        { runner: 'omp', model: 'openai-codex/gpt-5.6-terra', effort: 'xhigh' },
        { runner: 'claude', model: 'sonnet', effort: 'xhigh' },
      ],
    });
  });

  it('lists three candidates on three distinct runners for every step', () => {
    for (const candidates of Object.values(AUTO_V1_CANDIDATES_BY_ID)) {
      expect(candidates).toHaveLength(3);
      expect(new Set(candidates.map((candidate) => candidate.runner)).size).toBe(3);
    }
  });

  it('uses OMP only through the two openai-codex selectors, mirroring the preceding Codex candidate', () => {
    for (const candidates of Object.values(AUTO_V1_CANDIDATES_BY_ID)) {
      candidates.forEach((candidate, index) => {
        if (candidate.runner !== 'omp') return;
        const codex = candidates[index - 1];
        expect(codex?.runner).toBe('codex');
        expect(candidate.model).toBe(`openai-codex/${codex?.model}`);
        expect(candidate.effort).toBe(codex?.effort);
      });
    }
  });
});

describe('selectAutoRoute', () => {
  it('returns the first candidate with an empty rejection list when everything is available', () => {
    expect(selectAutoRoute('validate-problem', allAvailable())).toEqual({
      route: {
        runner: 'codex',
        model: 'gpt-5.6-sol',
        effort: 'xhigh',
        route: { policy: 'auto-v1', rejected: [] },
      },
    });
  });

  it('carries every rejection up to the selected candidate', () => {
    const reports: CapabilityReport[] = [
      {
        runner: 'codex',
        available: false,
        code: 'not_authenticated',
        reason: 'codex login status reported: Not logged in',
      },
      ompReport([['openai-codex/gpt-5.6-terra', OMP_EFFORTS]]),
      { runner: 'claude', available: true },
    ];

    expect(selectAutoRoute('validate-problem', reports)).toEqual({
      route: {
        runner: 'claude',
        model: 'opus',
        effort: 'medium',
        route: {
          policy: 'auto-v1',
          rejected: [
            {
              runner: 'codex',
              model: 'gpt-5.6-sol',
              effort: 'xhigh',
              code: 'not_authenticated',
              reason: 'codex login status reported: Not logged in',
            },
            {
              runner: 'omp',
              model: 'openai-codex/gpt-5.6-sol',
              effort: 'xhigh',
              code: 'model_unavailable',
              reason: 'omp models --json lists no selector openai-codex/gpt-5.6-sol.',
            },
          ],
        },
      },
    });
  });

  it('rejects an OMP candidate whose effort is outside the selector thinking levels', () => {
    const reports: CapabilityReport[] = [
      {
        runner: 'codex',
        available: false,
        code: 'executable_missing',
        reason: 'codex is not installed or not on PATH.',
      },
      ompReport([['openai-codex/gpt-5.6-sol', ['low', 'medium']]]),
      { runner: 'claude', available: true },
    ];

    const result = selectAutoRoute('validate-problem', reports);
    expect('route' in result && result.route.runner).toBe('claude');
    expect('route' in result && result.route.route.rejected[1]).toEqual({
      runner: 'omp',
      model: 'openai-codex/gpt-5.6-sol',
      effort: 'xhigh',
      code: 'effort_unsupported',
      reason:
        'omp selector openai-codex/gpt-5.6-sol supports thinking low, medium, not xhigh.',
    });
  });
});

describe('selectAutoRoute rejection completeness', () => {
  it('treats an empty thinking list as supporting no effort', () => {
    const reports: CapabilityReport[] = [
      {
        runner: 'codex',
        available: false,
        code: 'executable_missing',
        reason: 'codex is not installed or not on PATH.',
      },
      ompReport([['openai-codex/gpt-5.6-sol', []]]),
      { runner: 'claude', available: true },
    ];

    const result = selectAutoRoute('validate-problem', reports);
    expect('route' in result && result.route.route.rejected[1]).toMatchObject({
      code: 'effort_unsupported',
      reason: 'omp selector openai-codex/gpt-5.6-sol supports thinking none, not xhigh.',
    });
  });

  it('rejects a runner with no report as probe_failed', () => {
    const result = selectAutoRoute('commit', [{ runner: 'claude', available: true }]);
    expect(result).toMatchObject({ route: { runner: 'claude', model: 'haiku', effort: 'low' } });
    expect('route' in result && result.route.route.rejected.map((rejection) => rejection.code)).toEqual([
      'probe_failed',
      'probe_failed',
    ]);
  });

  it('returns every rejection when nothing is eligible', () => {
    const reports: CapabilityReport[] = [
      {
        runner: 'codex',
        available: false,
        code: 'executable_missing',
        reason: 'codex is not installed or not on PATH.',
      },
      {
        runner: 'omp',
        available: false,
        code: 'probe_timeout',
        reason: 'omp models --json did not finish within the probe timeout.',
      },
      {
        runner: 'claude',
        available: false,
        code: 'not_authenticated',
        reason: 'claude auth status --json reports loggedIn is not true.',
      },
    ];

    expect(selectAutoRoute('validate-problem', reports)).toEqual({
      rejected: [
        {
          runner: 'codex',
          model: 'gpt-5.6-sol',
          effort: 'xhigh',
          code: 'executable_missing',
          reason: 'codex is not installed or not on PATH.',
        },
        {
          runner: 'omp',
          model: 'openai-codex/gpt-5.6-sol',
          effort: 'xhigh',
          code: 'probe_timeout',
          reason: 'omp models --json did not finish within the probe timeout.',
        },
        {
          runner: 'claude',
          model: 'opus',
          effort: 'medium',
          code: 'not_authenticated',
          reason: 'claude auth status --json reports loggedIn is not true.',
        },
      ],
    });
  });
});

describe('probeHarnesses', () => {
  it('reports every runner available from the recorded probe shapes', async () => {
    const { exec, calls } = fakeExec({
      omp: ok(OMP_MODELS_JSON),
      codex: ok('Logged in using ChatGPT\n'),
      claude: ok('{"loggedIn": true, "authMethod": "claude.ai"}'),
    });

    const reports = await probeHarnesses(['codex', 'omp', 'claude'], exec);

    expect(reports).toEqual([
      { runner: 'codex', available: true },
      {
        runner: 'omp',
        available: true,
        models: new Map([
          ['openai-codex/gpt-5.6-sol', OMP_EFFORTS],
          ['openai-codex/gpt-5.6-terra', OMP_EFFORTS],
          ['anthropic/claude-haiku', []],
        ]),
      },
      { runner: 'claude', available: true },
    ]);
    expect(calls.map((call) => [call.file, ...call.args])).toEqual([
      ['codex', 'login', 'status'],
      ['omp', 'models', '--json'],
      ['claude', 'auth', 'status', '--json'],
    ]);
    expect(calls.every((call) => call.timeout === DEFAULT_PROBE_TIMEOUT_MS)).toBe(true);
  });

  it('maps ENOENT to executable_missing', async () => {
    const { exec } = fakeExec({});

    const [report] = await probeHarnesses(['codex'], exec);

    expect(report).toEqual({
      runner: 'codex',
      available: false,
      code: 'executable_missing',
      reason: 'codex is not installed or not on PATH.',
    });
  });

  it('maps a non-zero exit to not_authenticated for codex and claude, probe_failed for omp', async () => {
    const { exec } = fakeExec({
      codex: fail({ code: 1, stderr: 'Not logged in\n' }),
      claude: fail({ code: 1, stderr: '' }),
      omp: fail({ code: 2, stderr: 'boom: config missing\nmore' }),
    });

    const reports = await probeHarnesses(['codex', 'claude', 'omp'], exec);

    expect(reports).toEqual([
      {
        runner: 'codex',
        available: false,
        code: 'not_authenticated',
        reason: 'codex login status exited nonzero: Not logged in',
      },
      {
        runner: 'claude',
        available: false,
        code: 'not_authenticated',
        reason: 'claude auth status --json exited nonzero: Command failed',
      },
      {
        runner: 'omp',
        available: false,
        code: 'probe_failed',
        reason: 'omp models --json failed: boom: config missing',
      },
    ]);
  });
});

describe('probeHarnesses failure details', () => {
  it('maps a SIGTERM kill to probe_timeout', async () => {
    const { exec } = fakeExec({
      omp: fail({ killed: true, signal: 'SIGTERM', code: null }),
    });

    const [report] = await probeHarnesses(['omp'], exec);

    expect(report).toEqual({
      runner: 'omp',
      available: false,
      code: 'probe_timeout',
      reason: 'omp models --json did not finish within the probe timeout.',
    });
  });

  it('maps unparseable omp and claude output to probe_unparseable', async () => {
    const { exec } = fakeExec({ omp: ok('not json'), claude: ok('') });

    const reports = await probeHarnesses(['omp', 'claude'], exec);

    expect(reports.map((report) => report.code)).toEqual([
      'probe_unparseable',
      'probe_unparseable',
    ]);
    expect(reports.every((report) => report.available === false)).toBe(true);
  });

  it('treats loggedIn:false and a non "Logged in" codex line as not_authenticated', async () => {
    const { exec } = fakeExec({
      claude: ok('{"loggedIn": false}'),
      codex: ok('Not logged in\n'),
    });

    const reports = await probeHarnesses(['claude', 'codex'], exec);

    expect(reports).toEqual([
      {
        runner: 'claude',
        available: false,
        code: 'not_authenticated',
        reason: 'claude auth status --json reports loggedIn is not true.',
      },
      {
        runner: 'codex',
        available: false,
        code: 'not_authenticated',
        reason: 'codex login status reported: Not logged in',
      },
    ]);
  });

  it('accepts a successful Codex login status written to stderr after a warning', async () => {
    const { exec } = fakeExec({
      codex: ok('', 'WARNING: could not create PATH aliases\nLogged in using ChatGPT\n'),
    });

    const [report] = await probeHarnesses(['codex'], exec);

    expect(report).toEqual({ runner: 'codex', available: true });
  });

  it('probes each runner once even when requested twice', async () => {
    const { exec, calls } = fakeExec({ codex: ok('Logged in using ChatGPT') });

    const reports = await probeHarnesses(['codex', 'codex'], exec);

    expect(reports).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});
