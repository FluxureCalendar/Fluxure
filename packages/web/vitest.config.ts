import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte({ hot: false }), svelteTesting()],
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
      '$app/environment': path.resolve(__dirname, 'src/__tests__/mocks/app-environment.ts'),
      '$app/navigation': path.resolve(__dirname, 'src/__tests__/mocks/app-navigation.ts'),
      '$env/static/public': path.resolve(__dirname, 'src/__tests__/mocks/env-static-public.ts'),
    },
  },
  test: {
    clearMocks: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/setupTests.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      include: ['src/lib/**/*.ts'],
      exclude: ['src/__tests__/**', 'src/**/*.test.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
