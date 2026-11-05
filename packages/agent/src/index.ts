import type {
  AgentPort,
  AgentRunResult,
  ChatAnswer,
  Snapshot,
} from '@settle/shared';
import { MockLlm } from './llm/mockLlm.js';

export { MockLlm };
export * from './clock.js';
export * from './ids.js';
export * from './format.js';
export * from './prompts/selection.js';
export * from './llm/mockLlm.js';
export * from '@settle/shared';

/**
 * Creates an agent instance implementing AgentPort.
 * (Stage 1 stub implementation)
 */
export function createAgent(): AgentPort {
  return {
    async runCycle(_snapshot: Snapshot): Promise<AgentRunResult> {
      return {
        runId: 'run_stub',
        actions: [],
        skipped: [],
      };
    },
    async chat(_question: string, _snapshot: Snapshot): Promise<ChatAnswer> {
      return {
        text: 'Agent stub chat answer',
        toolCalls: [],
      };
    },
  };
}

export default createAgent;

