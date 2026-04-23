import http from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { testConnection, pool } from './db/pool.js';
import { logger } from './utils/logger.js';
import { createWsServer } from './ws/server.js';
import { closeRedisClients } from './config/redis.js';

const start = async () => {
  try {
    await testConnection();

    const app = createApp();
    const httpServer = http.createServer(app);
    const io = createWsServer(httpServer);

    httpServer.listen(env.PORT, () => {
      logger.info(`API running on http://localhost:${env.PORT}`);
      logger.info(`Environment: ${env.NODE_ENV}`);
    });

    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully...`);
      // Close in reverse dependency order: stop new WS connections first so
      // disconnect handlers can run, then the HTTP server, then drain Redis
      // and Postgres.
      await new Promise<void>((resolve) => io.close(() => resolve()));
      logger.info('Socket.IO server closed');
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      logger.info('HTTP server closed');
      await closeRedisClients();
      logger.info('Redis clients closed');
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
