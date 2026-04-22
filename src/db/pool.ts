import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle Postgres client', err);
});

export const testConnection = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    logger.info('Postgres connected');
  } finally {
    client.release();
  }
};
