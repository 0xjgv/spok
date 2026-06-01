/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports the surviving workflow template modules.
 */

export type { SkillTemplate, CommandTemplate } from './types.js';

export { getApplySkillTemplate, getOpsxApplyCommandTemplate } from './workflows/apply.js';
export { getArchiveSkillTemplate, getOpsxArchiveCommandTemplate } from './workflows/archive.js';
export { getExploreSkillTemplate, getExploreCommandTemplate } from './workflows/explore.js';
export { getOpsxProposeSkillTemplate, getOpsxProposeCommandTemplate } from './workflows/propose.js';
