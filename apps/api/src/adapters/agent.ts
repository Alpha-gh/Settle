import type { AgentPort } from '@settle/shared';
import { getEnv } from '../config/env.js';
import { StubAgent } from './stubs.js';

let agentInstance: AgentPort | null = null;

export async function getAgent(): Promise<AgentPort> {
  if (agentInstance) return agentInstance;

  const env = getEnv();
  if (env.AGENT_IMPL === 'stub') {
    agentInstance = new StubAgent();
    return agentInstance;
  }

  // Real agent implementation
  try {
    const agentModule = (await import(
      /* @vite-ignore */ ('@settle/agent' as string)
    )) as { createAgent?: () => AgentPort; default?: new () => AgentPort };

    if (agentModule.createAgent) {
      agentInstance = agentModule.createAgent();
    } else if (agentModule.default) {
      agentInstance = new agentModule.default();
    } else {
      throw new Error('@settle/agent does not export createAgent or default constructor');
    }
    return agentInstance;
  } catch (err) {
    throw new Error(
      `Failed to load real @settle/agent (AGENT_IMPL=real): ${err instanceof Error ? err.message : String(err)}. Ensure packages/agent is built and installed.`,
    );
  }
}

