import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  type SkillTemplate,
  getApplyChangeSkillTemplate,
  getArchiveChangeSkillTemplate,
  getBulkArchiveChangeSkillTemplate,
  getContinueChangeSkillTemplate,
  getExploreSkillTemplate,
  getFeedbackSkillTemplate,
  getFfChangeSkillTemplate,
  getNewChangeSkillTemplate,
  getOnboardSkillTemplate,
  getOpsxApplyCommandTemplate,
  getOpsxArchiveCommandTemplate,
  getOpsxBulkArchiveCommandTemplate,
  getOpsxContinueCommandTemplate,
  getOpsxExploreCommandTemplate,
  getOpsxFfCommandTemplate,
  getOpsxNewCommandTemplate,
  getOpsxOnboardCommandTemplate,
  getOpsxSyncCommandTemplate,
  getOpsxProposeCommandTemplate,
  getOpsxProposeSkillTemplate,
  getOpsxVerifyCommandTemplate,
  getSyncSpecsSkillTemplate,
  getVerifyChangeSkillTemplate,
} from '../../../src/core/templates/skill-templates.js';
import { generateSkillContent } from '../../../src/core/shared/skill-generation.js';

const EXPECTED_FUNCTION_HASHES: Record<string, string> = {
  getExploreSkillTemplate: 'd2e16e727029a64294ba08b286abcd27f73bfa57befc8134562a00e941e17cf8',
  getNewChangeSkillTemplate: '587313d14b656462ea51c8b7ba63364ef69a00d5ed20c0b9df2573fd2a6111ba',
  getContinueChangeSkillTemplate: 'f88acff2db45d7a2826021687dd548c602a0d0e39a19c9c88a4d12470b1fba83',
  getApplyChangeSkillTemplate: '1d8ed6731752e90e73147747fdc2aa635c5e56ca44c3a680d2daaec16d2c87a2',
  getFfChangeSkillTemplate: '766bd5d4df8354463e0960b2f2217134d6552e23cb9faa3e471ceabf2c8c5a48',
  getSyncSpecsSkillTemplate: 'c78530b96d1afefa7f8804a1dc9d09ac1fcdd6a79fe0fdd7ad5df5862967d183',
  getOnboardSkillTemplate: 'c09f145a1dbcf4d77e5c0a9285f27fa86d1bd4c6d1da2ca33e8d3fc78d9ac335',
  getOpsxExploreCommandTemplate: '6b1e0a06ed483cd5772d529ba629bb822c889b3bb671990b49fa4666914eb04b',
  getOpsxNewCommandTemplate: '29a333019c3d1c61a0ceae72055c9c1d3db2d70cf23dcf48530a5333df84b3f9',
  getOpsxContinueCommandTemplate: '67f4e6182e63f27ee098fac2d206709ad7c287b50372673a7fdfabd09f4dd6fa',
  getOpsxApplyCommandTemplate: 'e79d418a53e927f211162f1cf27fe549d1578fe860af39d54272493f3c7ff1e0',
  getOpsxFfCommandTemplate: 'db95224947e18efa062ac0ef9389863b59e7ad74d950d70a06be5140b06528ea',
  getArchiveChangeSkillTemplate: 'b07cb07ab0478dfdc0201a4d553d7c1702268475e9db6f12975e2717f104c71f',
  getBulkArchiveChangeSkillTemplate: '89d44ed149e4aaad3151a66edf5854ec558c47ec26a8a9ea419a8a2d8590fa5a',
  getOpsxSyncCommandTemplate: '9343f42691c19928e1f6d99d10bb850b03b40a7cae18e88a73822f532fbe7356',
  getVerifyChangeSkillTemplate: 'ad7633d6d8aec16f60d22a9c18d43c7507c3772c42adea95592231f310daa546',
  getOpsxArchiveCommandTemplate: 'b4bbf913ef687476f26ecdcb88ab3e7ca1b6716294945b78287e826ac3b1af14',
  getOpsxOnboardCommandTemplate: '135b0b885240f0335fa11ffaff2bdd1ac26aeded707d446c4c29de6ed4f7b2c3',
  getOpsxBulkArchiveCommandTemplate: '98c4f792e45a7f2ce85b1491a27069d080eb9f04cc8088e55c401f22c882d0f6',
  getOpsxVerifyCommandTemplate: 'd0e22433496b9aab2a819a6b7c99308693f05c94200fff70b92887de2944c1b1',
  getOpsxProposeSkillTemplate: 'b32ee08348e1c8c16ba2793b439fd5daeb22a64052182959b0017fc981089988',
  getOpsxProposeCommandTemplate: '67276ba83b5c01b329212e27f387bcfd2640f297c62b8260dbc3879ed428d5c0',
  getFeedbackSkillTemplate: 'a578471005cc5f93c41ec4a27e7d3acdb27bbab2aee00d291d145b07a0f80104',
};

const EXPECTED_GENERATED_SKILL_CONTENT_HASHES: Record<string, string> = {
  'spok-explore': 'ef049a55e03500a15b135e6f825d65b6729a5dec117f7907c99d5b20e30c7834',
  'spok-new-change': '741ff8b445b1e18c69fdda5b3bd8c902d8ee32cadc8938dbe6ae10f6ecc38083',
  'spok-continue-change': 'e04c59b14609008d527ba9af8673aa4739eb759f69cc769e750a8eb08f0bfee0',
  'spok-apply-change': '32314410f54709df083da28c9a30612deca9f8462eae515dfbf9467171223239',
  'spok-ff-change': '1ba0709344c5a1f8c9dc08fa0fc9ff62f6c55befacd60141fbeecb4d033a37e7',
  'spok-sync-specs': '9687c3fb8fcc6c04fbaf3471b3bc46cf40a43dfe2cc1e7cc1f7ae57d1d94ed0f',
  'spok-archive-change': 'd9cc7da73cfa28427f65c0a18947a11bf2f414a4825e01ff97a7b8356262e500',
  'spok-bulk-archive-change': '10b68387ac5b5311cd21c062da23d8c4bc82e94d4f2d7c09fbbf086906ab900e',
  'spok-verify-change': 'e3c8d3b78b11641a06b162e227518fcd84db0762ea489f910779c86cbdda2bd0',
  'spok-onboard': 'c58b1df05e93bff75790e754c595bcffaa24e07fd4c60847503cd0f46575dcbd',
  'spok-propose': 'ab6e604c27bb1edac2fc797eb4e23cca810870fcd2c3f7fa9ce5291698f801c2',
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('skill templates split parity', () => {
  it('preserves all template function payloads exactly', () => {
    const functionFactories: Record<string, () => unknown> = {
      getExploreSkillTemplate,
      getNewChangeSkillTemplate,
      getContinueChangeSkillTemplate,
      getApplyChangeSkillTemplate,
      getFfChangeSkillTemplate,
      getSyncSpecsSkillTemplate,
      getOnboardSkillTemplate,
      getOpsxExploreCommandTemplate,
      getOpsxNewCommandTemplate,
      getOpsxContinueCommandTemplate,
      getOpsxApplyCommandTemplate,
      getOpsxFfCommandTemplate,
      getArchiveChangeSkillTemplate,
      getBulkArchiveChangeSkillTemplate,
      getOpsxSyncCommandTemplate,
      getVerifyChangeSkillTemplate,
      getOpsxArchiveCommandTemplate,
      getOpsxOnboardCommandTemplate,
      getOpsxBulkArchiveCommandTemplate,
      getOpsxVerifyCommandTemplate,
      getOpsxProposeSkillTemplate,
      getOpsxProposeCommandTemplate,
      getFeedbackSkillTemplate,
    };

    const actualHashes = Object.fromEntries(
      Object.entries(functionFactories).map(([name, fn]) => [name, hash(stableStringify(fn()))])
    );

    expect(actualHashes).toEqual(EXPECTED_FUNCTION_HASHES);
  });

  it('preserves generated skill file content exactly', () => {
    // Intentionally excludes getFeedbackSkillTemplate: skillFactories only models templates
    // deployed via generateSkillContent, while feedback is covered in function payload parity.
    const skillFactories: Array<[string, () => SkillTemplate]> = [
      ['spok-explore', getExploreSkillTemplate],
      ['spok-new-change', getNewChangeSkillTemplate],
      ['spok-continue-change', getContinueChangeSkillTemplate],
      ['spok-apply-change', getApplyChangeSkillTemplate],
      ['spok-ff-change', getFfChangeSkillTemplate],
      ['spok-sync-specs', getSyncSpecsSkillTemplate],
      ['spok-archive-change', getArchiveChangeSkillTemplate],
      ['spok-bulk-archive-change', getBulkArchiveChangeSkillTemplate],
      ['spok-verify-change', getVerifyChangeSkillTemplate],
      ['spok-onboard', getOnboardSkillTemplate],
      ['spok-propose', getOpsxProposeSkillTemplate],
    ];

    const actualHashes = Object.fromEntries(
      skillFactories.map(([dirName, createTemplate]) => [
        dirName,
        hash(generateSkillContent(createTemplate(), 'PARITY-BASELINE')),
      ])
    );

    expect(actualHashes).toEqual(EXPECTED_GENERATED_SKILL_CONTENT_HASHES);
  });

  it('guards unsupported workspace workflows from repo-local fallback edits', () => {
    const guardedSkills: Array<[string, () => SkillTemplate, string]> = [
      ['spok-apply-change', getApplyChangeSkillTemplate, 'full workspace apply is not supported'],
      ['spok-sync-specs', getSyncSpecsSkillTemplate, 'workspace spec sync is not supported'],
      ['spok-archive-change', getArchiveChangeSkillTemplate, 'workspace archive is not supported'],
      ['spok-bulk-archive-change', getBulkArchiveChangeSkillTemplate, 'workspace bulk archive is not supported'],
      ['spok-verify-change', getVerifyChangeSkillTemplate, 'full workspace implementation verification is not supported'],
    ];

    for (const [dirName, createTemplate, guardText] of guardedSkills) {
      const content = generateSkillContent(createTemplate(), 'PARITY-BASELINE');

      expect(content, dirName).toContain('actionContext.mode: "workspace-planning"');
      expect(content, dirName).toContain(guardText);
      expect(content, dirName).not.toContain('spok/changes/<name>');
      expect(content, dirName).not.toContain('mv spok/changes');
    }
  });
});
