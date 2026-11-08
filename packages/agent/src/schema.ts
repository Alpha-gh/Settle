import { z } from 'zod';

export interface DecisionPayload {
  optionId: string;
  reason: string;
}

export interface DecisionSchemaOutput {
  jsonSchema: {
    type: 'object';
    properties: {
      optionId: {
        type: 'string';
        enum: string[];
      };
      reason: {
        type: 'string';
        maxLength: number;
      };
    };
    required: ['optionId', 'reason'];
    additionalProperties: false;
  };
  validator: z.ZodType<DecisionPayload>;
}

/**
 * Builds both JSON schema and matching Zod validator for option decisions.
 */
export function buildDecisionSchema(ids: string[]): DecisionSchemaOutput {
  const jsonSchema = {
    type: 'object' as const,
    properties: {
      optionId: {
        type: 'string' as const,
        enum: ids,
      },
      reason: {
        type: 'string' as const,
        maxLength: 280,
      },
    },
    required: ['optionId', 'reason'] as ['optionId', 'reason'],
    additionalProperties: false as const,
  };

  const validator = z
    .object({
      optionId:
        ids.length > 0
          ? z.enum([ids[0]!, ...ids.slice(1)] as [string, ...string[]])
          : z.string(),
      reason: z.string().max(280),
    })
    .strict();

  return { jsonSchema, validator };
}

