import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // tsconfig sets `jsx: preserve` (Next.js owns the JSX transform), so vitest
  // needs its own setting to render .tsx components in component tests.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'node',
  },
});
