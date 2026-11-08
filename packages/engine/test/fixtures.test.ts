import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateAllFixtures } from '../test-support/fixturesData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../fixtures');

describe('fixtures drift check', () => {
  const generated = generateAllFixtures();

  it('matches all committed fixture files byte-for-byte', () => {
    for (const [filename, expectedContent] of Object.entries(generated)) {
      const filePath = path.join(fixturesDir, filename);
      expect(existsSync(filePath)).toBe(true);

      const actualContent = readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
      const normalizedExpected = expectedContent.replace(/\r\n/g, '\n');
      expect(actualContent).toBe(normalizedExpected);
    }
  });

  it('has a descriptive README.md in fixtures/', () => {
    const readmePath = path.join(fixturesDir, 'README.md');
    expect(existsSync(readmePath)).toBe(true);
    const content = readFileSync(readmePath, 'utf-8');
    expect(content).toContain('ForecastResult');
    expect(content).toContain('ScenarioComparison');
  });
});

