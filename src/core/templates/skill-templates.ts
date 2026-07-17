/**
 * Agent Skill Templates
 *
 * Compatibility facade that re-exports the surviving workflow template modules.
 */

export type { SkillTemplate, CommandTemplate } from './types.js';

export { getApplySkillTemplate, getApplyCommandTemplate } from './workflows/apply.js';
export { getArchiveSkillTemplate, getArchiveCommandTemplate } from './workflows/archive.js';
export { getExploreSkillTemplate, getExploreCommandTemplate } from './workflows/explore.js';
export { getProposeSkillTemplate, getProposeCommandTemplate } from './workflows/propose.js';
