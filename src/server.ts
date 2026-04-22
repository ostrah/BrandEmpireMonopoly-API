import { createApp } from './app.js';
import { env } from './config/env.js';
import { testConnection, pool } from './db/pool.js';
import { logger } from './utils/logger.js';

const start = async () => {
  try {
    await testConnection();

    const app = createApp();
    const server = app.listen(env.PORT, () => {
      logger.info(`API running on http://localhost:${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      server.close(() => logger.info('HTTP server closed'));
      await pool.end();
      logger.info('Postgres pool closed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));
  } catch (err) {
    logger.error('Failed to start server', err);
    process.exit(1);
  }
};

start();
