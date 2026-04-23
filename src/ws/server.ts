import type { Server as HTTPServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getRedisClients, hasRedis } from '../config/redis.js';
import { wsAuth } from './auth.js';
import { registerRoomHandlers } from './handlers/rooms.js';
import { setIo } from './events.js';

export interface SocketUser {
  id: string;
  email: string;
  username: string;
}

declare module 'socket.io' {
  interface SocketData {
    user?: SocketUser;
  }
}

/**
 * Attach a Socket.IO server to an existing HTTP server. Uses the Redis
 * adapter for cross-instance broadcasts when REDIS_URL is configured;
 * otherwise runs in single-instance mode (dev/test).
 *
 * The returned server is also stashed in src/ws/events.ts so domain services
 * can fire broadcasts without taking `io` as a dependency.
 */
export const createWsServer = (httpServer: HTTPServer): IOServer => {
  const io = new IOServer(httpServer, {
    cors: {
      origin: env.FRONTEND_URL,
      credentials: true,
    },
    // Skip long-polling: modern clients can negotiate WS directly, and dropping
    // the polling transport simplifies the threat model (no CSRF via polling).
    transports: ['websocket'],
    pingInterval: 25_000,
    pingTimeout: 20_000,
  });

  if (hasRedis()) {
    const clients = getRedisClients();
    if (clients) {
      io.adapter(createAdapter(clients.pub, clients.sub));
      logger.info('Socket.IO using Redis adapter');
    }
  } else {
    logger.warn('Socket.IO running without Redis adapter (single-instance mode)');
  }

  io.use(wsAuth);
  io.on('connection', (socket: Socket) => {
    logger.info('WS connected', { userId: socket.data.user?.id });
    registerRoomHandlers(io, socket);
  });

  setIo(io);
  return io;
};
