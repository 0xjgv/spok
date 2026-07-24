import { z } from 'zod';
import { containsShallOrMust } from '../parsers/requirement-text.js';
import { VALIDATION_MESSAGES } from '../validation/constants.js';

export const ScenarioSchema = z.object({
  rawText: z.string().min(1, VALIDATION_MESSAGES.SCENARIO_EMPTY),
});

export const RequirementSchema = z.object({
  text: z.string()
    .min(1, VALIDATION_MESSAGES.REQUIREMENT_EMPTY)
    .refine(
      containsShallOrMust,
      VALIDATION_MESSAGES.REQUIREMENT_NO_SHALL
    ),
  scenarios: z.array(ScenarioSchema)
    .min(1, VALIDATION_MESSAGES.REQUIREMENT_NO_SCENARIOS),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type Requirement = z.infer<typeof RequirementSchema>;
