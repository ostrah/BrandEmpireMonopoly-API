import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db/pool.js';
import { logger } from '../src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');

const run = async () => {
  logger.info('Starting migrations...');
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id        SERIAL PRIMARY KEY,
        name      VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const applied = await client.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY id'
    );
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        logger.info(`Skipping already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`Failed: ${file}`, err);
        throw err;
      }
    }

    logger.info('All migrations complete');
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((err) => {
  logger.error('Migration runner crashed', err);
  process.exit(1);
});
