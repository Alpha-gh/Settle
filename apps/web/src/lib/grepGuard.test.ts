import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function getFilesRecursively(dir: string, fileList: string[] = []): string[] {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      if (file !== 'mocks' && file !== 'test' && file !== 'node_modules') {
        getFilesRecursively(fullPath, fileList);
      }
    } else if (
      (file.endsWith('.ts') || file.endsWith('.tsx')) &&
      !file.endsWith('.test.ts') &&
      !file.endsWith('.test.tsx')
    ) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

describe('Grep Guard Tests', () => {
  const srcDir = path.resolve(__dirname, '..');
  const allSourceFiles = getFilesRecursively(srcDir);

  it('prohibits toFixed anywhere in production src', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        // Ignore comments
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (line.includes('.toFixed(')) {
          violations.push({ file: path.relative(srcDir, filePath), line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('prohibits parseFloat in production src', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (line.includes('parseFloat(')) {
          violations.push({ file: path.relative(srcDir, filePath), line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('prohibits * 100 and / 100 outside lib/format.ts and lib/money.ts', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of allSourceFiles) {
      const relative = path.relative(srcDir, filePath).replace(/\\/g, '/');
      if (relative === 'lib/format.ts' || relative === 'lib/money.ts') continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (/\*\s*100\b/.test(line) || /\/\s*100\b/.test(line)) {
          violations.push({ file: relative, line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('prohibits TypeScript any types in production src', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of allSourceFiles) {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        // Check for : any, as any, <any>, Record<any, ...
        if (
          /:\s*any\b/.test(line) ||
          /\bas\s+any\b/.test(line) ||
          /<any[>,]/.test(line) ||
          /Record<\s*any\b/.test(line)
        ) {
          violations.push({ file: path.relative(srcDir, filePath), line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('ensures no hardcoded demo text like "$2,000" or "Fri 6 Nov" in component code', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of allSourceFiles) {
      const relative = path.relative(srcDir, filePath).replace(/\\/g, '/');
      if (relative === 'lib/format.ts' || relative === 'lib/money.ts') continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
        if (line.includes('$2,000') || line.includes('Fri 6 Nov')) {
          violations.push({ file: relative, line: idx + 1, text: line.trim() });
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

