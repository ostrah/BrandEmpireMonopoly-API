import { Redis } from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/**
 * Redis is optional. When REDIS_URL is unset we run the WS layer in
 * single-instance mode (no pub/sub fan-out across API pods). This keeps
 * local dev and the test suite hermetic.
 */
export const hasRedis = (): boolean => Boolean(env.REDIS_URL);

const buildClient = (label: string): RedisClient => {
  const client = new Redis(env.REDIS_URL!, {
    lazyConnect: false,
    // Adapter needs responses during shutdown; don't flood with retries.
    maxRetriesPerRequest: 3,
  });
  client.on('error', (err: Error) => logger.error(`Redis(${label}) error`, err));
  client.on('connect', () => logger.info(`Redis(${label}) connected`));
  client.on('end', () => logger.info(`Redis(${label}) connection ended`));
  return client;
};

let pubClient: RedisClient | null = null;
let subClient: RedisClient | null = null;

/**
 * Lazily create and memoise the pub/sub client pair used by the Socket.IO
 * Redis adapter. Returns null if REDIS_URL is not configured — callers must
 * fall back to in-memory adapters.
 */
export const getRedisClients = (): { pub: RedisClient; sub: RedisClient } | null => {
  if (!hasRedis()) return null;
  if (!pubClient) pubClient = buildClient('pub');
  if (!subClient) subClient = buildClient('sub');
  return { pub: pubClient, sub: subClient };
};

export const closeRedisClients = async (): Promise<void> => {
  const tasks: Promise<unknown>[] = [];
  if (pubClient) {
    tasks.push(pubClient.quit().catch(() => undefined));
    pubClient = null;
  }
  if (subClient) {
    tasks.push(subClient.quit().catch(() => undefined));
    subClient = null;
  }
  await Promise.allSettled(tasks);
};
