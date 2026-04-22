import type { PoolClient } from 'pg';
import { pool } from './pool.js';

/**
 * Run a block of queries inside a single Postgres transaction.
 * Commits on success, rolls back on any thrown error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* noop — original error is what we want to surface */
    }
    throw err;
  } finally {
    client.release();
  }
}
