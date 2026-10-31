import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Snapshot } from './types.js';

/**
 * Load the demo seed snapshot from seed/demo.json at the repo root.
 * Useful for tests and dev tooling in other packages.
 */
export function loadSeedSnapshot(): Snapshot {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'seed', 'demo.json'),
    resolve(here, '..', '..', '..', 'seed', 'demo.json'),
    resolve(here, '..', '..', 'seed', 'demo.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const raw = readFileSync(candidate, 'utf-8');
      return JSON.parse(raw) as Snapshot;
    }
  }
  throw new Error(`Unable to locate seed/demo.json in paths: ${candidates.join(', ')}`);
}
