import fs from 'node:fs';
import path from 'node:path';
import { GeminiLlm } from '../src/llm/geminiLlm.js';
import { buildDecisionSchema } from '../src/schema.js';
import { createAgent } from '../src/agent.js';
import type { Snapshot } from '@settle/shared';

// Helper to safely load .env without printing secrets
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  const envPaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(process.cwd(), '../.env'),
  ];

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
          if (!env[key]) {
            env[key] = val;
          }
        }
      }
    }
  }
  return env;
}

function redact(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/key=[^&\s]+/g, 'key=[REDACTED]');
}

async function main() {
  const env = loadEnv();
  const apiKey = env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    console.log('NOTICE: GEMINI_API_KEY is not available in local .env. Live check skipped.');
    return;
  }

  const model = env.LLM_MODEL || 'gemini-3.6-flash';
  console.log(`Starting live check with model: ${model} (key: ${redact(apiKey)})`);

  // 1. Single decision schema call
  const llm = new GeminiLlm({
    apiKey,
    model,
  });

  const sampleOptionIds = ['opt_1', 'opt_2', 'escalate'];
  const { jsonSchema } = buildDecisionSchema(sampleOptionIds);

  console.log('\n--- Step 1: Probe decision call through Gemini adapter ---');
  try {
    const res = await llm.generateStructured<{ optionId: string; reason: string }>({
      system:
        'You are an accounts-receivable agent. Select the best option from the list and provide a 1-sentence factual rationale quoting only verified numbers.',
      user:
        'Invoice: inv_001. Amount: $3,500.00. Options: opt_1 (offer 3% discount), opt_2 (offer 3 instalments), escalate (escalate to collections). Choose one optionId and provide reason.',
      jsonSchema,
    });

    console.log('Parsed result:', res);
    console.log('Result optionId:', res.optionId);
    console.log('Result reason:', redact(res.reason));
  } catch (err: any) {
    console.error('Probe call failed:', redact(err?.message || String(err)));
  }

  // 2. Full agent cycle on seed data if engine & seed are accessible
  console.log('\n--- Step 2: Agent cycle check ---');
  const seedPath = path.resolve(process.cwd(), 'seed/demo.json');
  const rootSeedPath = path.resolve(process.cwd(), '../../seed/demo.json');
  const targetSeed = fs.existsSync(seedPath) ? seedPath : fs.existsSync(rootSeedPath) ? rootSeedPath : null;

  if (!targetSeed) {
    console.log('Seed demo.json not found in local path; skipping full cycle.');
    return;
  }

  try {
    const snapshot: Snapshot = JSON.parse(fs.readFileSync(targetSeed, 'utf-8'));
    // Dynamically load engine
    let engine: any;
    try {
      const engineModuleName = '@settle/engine';
      const engineMod = (await import(/* @vite-ignore */ engineModuleName as string)) as any;
      engine = engineMod.engine || new engineMod.ForecastEngine();
    } catch {
      console.log('@settle/engine could not be loaded dynamically; skipping full agent cycle.');
      return;
    }

    const agent = createAgent({
      engine,
      llm,
    });

    const result = await agent.runCycle(snapshot);
    console.log(`\nRun ID: ${result.runId}`);
    console.log(`Generated ${result.actions.length} actions:`);

    for (const act of result.actions) {
      const reasonSourceMatch = act.reason.match(/\[via ([^\]]+)\]/);
      const reasonSource = reasonSourceMatch ? reasonSourceMatch[0] : 'unknown';
      console.log(`- Invoice: ${act.invoiceId} | Type: ${act.type} | Source: ${reasonSource}`);
      if (reasonSource.includes('path=fallback')) {
        console.log(`  Fallback rationale: ${redact(act.reason)}`);
      }
    }
  } catch (err: any) {
    console.error('Agent cycle failed:', redact(err?.message || String(err)));
  }
}

main().catch((err) => {
  console.error('Live check encountered unhandled error:', redact(err?.message || String(err)));
  process.exit(1);
});
