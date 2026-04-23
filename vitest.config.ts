import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import path from 'node:path';

// Load test env vars into process.env BEFORE vitest spawns any worker.
// Workers inherit the parent environment, so src/config/env.ts parses these.
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    setupFiles: ['./tests/setup.ts'],
    // Tests share a single Postgres database — avoid parallel file execution
    // to keep fixtures deterministic. Individual tests inside a file still
    // run sequentially (default).
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
