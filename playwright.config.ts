import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['./server/live-reporter.cjs'], ['json', { outputFile: '.data/latest-results.json' }]],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  outputDir: 'test-results',
});
