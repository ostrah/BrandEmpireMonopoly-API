import { vi, beforeEach, afterAll } from 'vitest';
import dotenv from 'dotenv';
import path from 'node:path';

// Reload .env.test inside each worker. Vitest.config.ts loads it in the
// parent process, but defensive reloads keep single-file runs (`vitest run file`)
// working identically.
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { mailbox } from './helpers/mailbox.js';

// Mock nodemailer at the module level so src/services/mail.service.ts picks up
// our transporter. vi.mock calls are hoisted to the top of the file by vitest.
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      sendMail: async (opts: { to: string; subject: string; html: string }) => {
        mailbox.push({ to: opts.to, subject: opts.subject, html: opts.html });
        return { messageId: `test-${mailbox.length}` };
      },
    }),
  },
}));

// Clean slate between tests: drop every row from user-facing tables.
// Use DELETE rather than TRUNCATE so we don't invalidate prepared statements
// or fight with foreign-key ordering — CASCADE on FKs handles dependents.
beforeEach(async () => {
  mailbox.length = 0;
  const { pool } = await import('../src/db/pool.js');
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM room_players');
  await pool.query('DELETE FROM rooms');
  await pool.query('DELETE FROM users');
});

// Close pool after each test file — otherwise vitest hangs waiting on idle clients.
afterAll(async () => {
  const { pool } = await import('../src/db/pool.js');
  await pool.end();
});
