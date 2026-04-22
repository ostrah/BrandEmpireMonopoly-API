import type { Request, Response, NextFunction } from 'express';
import { HttpError } from '../utils/httpError.js';

type KeyFn = (req: Request) => string;

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Simple in-memory fixed-window rate limiter.
 * Stage 3 will replace this with a Redis-backed implementation (distributed, persistent).
 */
export const rateLimit = (opts: {
  max: number;
  windowMs: number;
  keyFn?: KeyFn;
  name: string;
}) => {
  const buckets = new Map<string, Bucket>();
  const keyFn: KeyFn = opts.keyFn ?? ((req) => `${req.ip ?? 'unknown'}`);

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${opts.name}:${keyFn(req)}`;
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }

    if (bucket.count >= opts.max) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      next(HttpError.tooManyRequests('rate_limited', `Too many requests. Retry in ${retryAfterSec}s.`));
      return;
    }

    bucket.count += 1;
    next();
  };
};

/** Key by IP + a body field (e.g., email) to prevent per-account brute force. */
export const keyByIpAndBodyField = (field: string): KeyFn =>
  (req) => {
    const value = typeof req.body === 'object' && req.body
      ? String((req.body as Record<string, unknown>)[field] ?? '').toLowerCase()
      : '';
    return `${req.ip ?? 'unknown'}|${value}`;
  };
