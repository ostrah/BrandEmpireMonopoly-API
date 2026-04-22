import type { Request, Response, NextFunction } from 'express';
import { tokenService } from '../services/token.service.js';
import { HttpError } from '../utils/httpError.js';

export const requireAuth = (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    next(HttpError.unauthorized('missing_token', 'Missing or malformed Authorization header'));
    return;
  }

  const token = header.slice(7).trim();
  try {
    const payload = tokenService.verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email, username: payload.username };
    next();
  } catch {
    next(HttpError.unauthorized('invalid_token', 'Access token invalid or expired'));
  }
};
