import type { EnginePort } from '@settle/shared';
import { getEnv } from '../config/env.js';
import { StubEngine } from './stubs.js';

let engineInstance: EnginePort | null = null;

export async function getEngine(): Promise<EnginePort> {
  if (engineInstance) return engineInstance;

  const env = getEnv();
  if (env.ENGINE_IMPL === 'stub') {
    engineInstance = new StubEngine();
    return engineInstance;
  }

  // Real engine implementation
  try {
    // Dynamic import to avoid build errors when packages/engine is absent
    const engineModule = (await import(
      /* @vite-ignore */ ('@settle/engine' as string)
    )) as { createEngine?: () => EnginePort; default?: new () => EnginePort };

    if (engineModule.createEngine) {
      engineInstance = engineModule.createEngine();
    } else if (engineModule.default) {
      engineInstance = new engineModule.default();
    } else {
      throw new Error('@settle/engine does not export createEngine or default constructor');
    }
    return engineInstance;
  } catch (err) {
    throw new Error(
      `Failed to load real @settle/engine (ENGINE_IMPL=real): ${err instanceof Error ? err.message : String(err)}. Ensure packages/engine is built and installed.`,
    );
  }
}

