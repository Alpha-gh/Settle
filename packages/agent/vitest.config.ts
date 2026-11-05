import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sharedSrc = resolve(__dirname, '../shared/src/index.ts');
const vendorShared = resolve(__dirname, 'vendor/shared/index.ts');
const target = existsSync(sharedSrc) ? sharedSrc : vendorShared;

export default defineConfig({
  resolve: {
    alias: {
      '@settle/shared': target,
    },
  },
  test: {
    globals: true,
    include: ['__tests__/**/*.test.ts'],
  },
});

