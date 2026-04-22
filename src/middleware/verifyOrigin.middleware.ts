import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

const allowedOrigin = normalize(env.FRONTEND_URL);

/**
 * Require Origin or Referer header to match FRONTEND_URL.
 * Active only in production. In development/test we allow curl/Postman (missing Origin).
 */
export const verifyOrigin = (req: Request, _res: Response, next: NextFunction) => {
  if (env.NODE_ENV !== 'production') {
    next();
    return;
  }

  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;

  if (origin && normalize(origin) === allowedOrigin) {
    next();
    return;
  }

  if (!origin && referer && normalize(referer).startsWith(allowedOrigin)) {
    next();
    return;
  }

  next(HttpError.forbidden('origin_not_allowed', 'Origin is not allowed'));
};

function normalize(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}
