import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');

function getAllSourceFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getAllSourceFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

describe('Purity Audit for packages/engine/src', () => {
  const sourceFiles = getAllSourceFiles(srcDir);

  it('scans a non-empty set of source files in src/', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  for (const filePath of sourceFiles) {
    const relativePath = path.relative(srcDir, filePath);

    describe(`File: ${relativePath}`, () => {
      const content = fs.readFileSync(filePath, 'utf-8');

      it('does not contain Date.now', () => {
        expect(content).not.toContain('Date.now');
      });

      it('does not contain Math.random', () => {
        expect(content).not.toContain('Math.random');
      });

      it('does not contain zero-argument new Date()', () => {
        const zeroArgNewDate = /new\s+Date\s*\(\s*\)/;
        expect(zeroArgNewDate.test(content)).toBe(false);
      });

      it('does not contain process.env', () => {
        expect(content).not.toContain('process.env');
      });

      it('does not import or reference node fs or http', () => {
        const forbiddenModules = [
          /'fs'/,
          /"fs"/,
          /'node:fs'/,
          /"node:fs"/,
          /'http'/,
          /"http"/,
          /'node:http'/,
          /"node:http"/,
          /'https'/,
          /"https"/,
          /'node:https'/,
          /"node:https"/,
        ];
        for (const pattern of forbiddenModules) {
          expect(pattern.test(content)).toBe(false);
        }
      });

      it('does not call fetch', () => {
        expect(content).not.toMatch(/\bfetch\s*\(/);
      });

      it('only imports from @settle/shared or relative paths', () => {
        // Match: import ... from '...'; import '...'; export ... from '...'
        const importExportRegex = /(?:import|export)\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;
        let match: RegExpExecArray | null;

        while ((match = importExportRegex.exec(content)) !== null) {
          const importSource = match[1]!;
          const isShared = importSource === '@settle/shared';
          const isRelative = importSource.startsWith('./') || importSource.startsWith('../');

          expect(
            isShared || isRelative,
            `Forbidden import "${importSource}" found in ${relativePath}. Only "@settle/shared" or relative paths are permitted.`,
          ).toBe(true);
        }
      });
    });
  }
});

