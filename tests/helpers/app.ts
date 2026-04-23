import { createApp } from '../../src/app.js';

// Build one Express app per test file. We rebuild fresh on import so rate-limit
// buckets (stored in module-level closures inside middleware) don't bleed
// configuration between files — the middleware themselves are module singletons
// but supertest requests are isolated enough for our fixtures when combined
// with the `X-Forwarded-For` trick in tests/helpers/users.ts.
export const app = createApp();
