import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
}

export const tokenService = {
  signAccessToken(payload: AccessTokenPayload): string {
    const opts: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'] };
    return jwt.sign(payload, env.JWT_ACCESS_SECRET, opts);
  },

  verifyAccessToken(token: string): AccessTokenPayload {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    if (typeof decoded === 'string') throw new Error('Invalid access token');
    const { sub, email, username } = decoded as jwt.JwtPayload & Partial<AccessTokenPayload>;
    if (!sub || !email || !username) throw new Error('Invalid access token payload');
    return { sub, email, username };
  },

  /** Generate opaque random token (url-safe base64, 32 bytes -> ~43 chars). */
  generateOpaqueToken(bytes = 32): string {
    return crypto.randomBytes(bytes).toString('base64url');
  },

  /** SHA-256 hash (hex, 64 chars) — used to store refresh/verify/reset tokens safely. */
  sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  },

  /** Compute expiry Date from a TTL string like "15m", "7d", "24h", "1h". */
  computeExpiry(ttl: string, from: Date = new Date()): Date {
    const ms = parseTtlToMs(ttl);
    return new Date(from.getTime() + ms);
  },
};

function parseTtlToMs(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)$/.exec(ttl.trim());
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const n = Number(match[1]);
  switch (match[2]) {
    case 'ms': return n;
    case 's':  return n * 1000;
    case 'm':  return n * 60 * 1000;
    case 'h':  return n * 60 * 60 * 1000;
    case 'd':  return n * 24 * 60 * 60 * 1000;
    default:   throw new Error(`Invalid TTL unit: ${match[2]}`);
  }
}
