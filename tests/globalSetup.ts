import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import dotenv from 'dotenv';

// Safety net: reload .env.test in case globalSetup is invoked in a fresh process.
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

const TEST_DB = 'brand_empire_test';
const ADMIN_URL = 'postgresql://beuser:bepass@localhost:5432/postgres';

const migrationsDir = path.resolve(process.cwd(), 'src/db/migrations');

async function ensureDatabaseExists(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ exists: number }>(
      'SELECT 1 AS exists FROM pg_database WHERE datname = $1',
      [TEST_DB]
    );
    if (rows.length === 0) {
      // CREATE DATABASE cannot run in a transaction; pg-client auto-commits each statement.
      await admin.query(`CREATE DATABASE ${TEST_DB}`);
    }
  } finally {
    await admin.end();
  }
}

async function runMigrations(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const applied = await client.query<{ name: string }>(
      'SELECT name FROM _migrations'
    );
    const appliedSet = new Set(applied.rows.map((r) => r.name));

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

export default async function () {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `globalSetup expected NODE_ENV=test, got ${process.env.NODE_ENV ?? '<unset>'}`
    );
  }
  if (!process.env.DATABASE_URL?.includes('brand_empire_test')) {
    throw new Error(
      'Refusing to run tests — DATABASE_URL must point at brand_empire_test, got ' +
        String(process.env.DATABASE_URL)
    );
  }

  await ensureDatabaseExists();
  await runMigrations();
}
