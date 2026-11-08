import type { AgentPort, EnginePort, Id, ISODate, LlmPort, Policy } from '@settle/shared';
import { getEnv } from '../config/env.js';
import { getEngine } from './engine.js';
import { StubAgent } from './stubs.js';

let agentInstance: AgentPort | null = null;
let agentRunInProgress = false;

export function resetAgentInstance(): void {
  agentInstance = null;
}

export function setAgentInstance(agent: AgentPort | null): void {
  agentInstance = agent;
}

export function acquireAgentRunLock(): boolean {
  if (agentRunInProgress) {
    return false;
  }
  agentRunInProgress = true;
  return true;
}

export function releaseAgentRunLock(): void {
  agentRunInProgress = false;
}

export function resetAgentRunLock(): void {
  agentRunInProgress = false;
}

export interface Clock {
  now(): Date;
  todayISO(): ISODate;
}

export interface AgentModuleExports {
  createAgent: (options: {
    engine: EnginePort;
    llm: LlmPort;
    clock?: Clock;
    idGen?: unknown;
    remindersLookup?: (invoiceId: Id) => number;
    policy?: Policy;
  }) => AgentPort;
  createLlmFromEnv: (env?: Record<string, string | undefined>) => LlmPort & {
    info?: { provider: string; model: string };
  };
  MockLlm: new (options?: unknown) => LlmPort;
  SystemClock: new () => Clock;
  FixedClock: new (timestampOrIso: string | Date | number) => Clock;
  default?: unknown;
}

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
    )) as AgentModuleExports;

    if (!agentModule.createAgent) {
      throw new Error('@settle/agent does not export createAgent');
    }

    const engine = await getEngine();

    // Determine LLM provider & fallback safely to MockLlm if API key is missing
    let llm: LlmPort;
    let providerName = 'mock';
    let modelName = 'mock-model';

    const requestedProvider = (process.env.LLM_PROVIDER || '').trim().toLowerCase();
    const hasKey =
      (requestedProvider === 'gemini' && !!process.env.GEMINI_API_KEY?.trim()) ||
      (requestedProvider === 'anthropic' && !!process.env.ANTHROPIC_API_KEY?.trim()) ||
      (requestedProvider === 'openai' && !!process.env.OPENAI_API_KEY?.trim());

    if (requestedProvider && requestedProvider !== 'mock' && !hasKey) {
      console.log(
        `[agent] LLM_PROVIDER=${requestedProvider} requested but no API key configured. Working through MockLlm / rules path.`,
      );
      llm = new agentModule.MockLlm();
      providerName = 'mock';
      modelName = 'mock-model';
    } else {
      try {
        llm = agentModule.createLlmFromEnv(process.env);
        const maybeInfo = (llm as { info?: { provider: string; model: string } }).info;
        if (maybeInfo) {
          providerName = maybeInfo.provider;
          modelName = maybeInfo.model;
        }
      } catch (err) {
        console.warn(
          `[agent] Failed to initialize provider "${requestedProvider}": ${err instanceof Error ? err.message : String(err)}. Falling back to MockLlm.`,
        );
        llm = new agentModule.MockLlm();
        providerName = 'mock';
        modelName = 'mock-model';
      }
    }

    console.log(`[agent] Agent initialized with LLM provider: ${providerName}, model: ${modelName}`);

    // Honor POLICY_IGNORE_QUIET_HOURS: inject fixed midday UTC clock if true, else SystemClock
    let clock: Clock | undefined;
    if (env.POLICY_IGNORE_QUIET_HOURS) {
      const fixedMidday = `${env.DEMO_TODAY || '2026-11-05'}T12:00:00Z`;
      clock = new agentModule.FixedClock(fixedMidday);
      console.log(`[agent] POLICY_IGNORE_QUIET_HOURS=true: injected FixedClock(${fixedMidday})`);
    } else {
      clock = new agentModule.SystemClock();
    }

    agentInstance = agentModule.createAgent({
      engine,
      llm,
      clock,
    });

    return agentInstance;
  } catch (err) {
    throw new Error(
      `Failed to load real @settle/agent (AGENT_IMPL=real): ${err instanceof Error ? err.message : String(err)}. Ensure packages/agent is built and installed.`,
    );
  }
}
