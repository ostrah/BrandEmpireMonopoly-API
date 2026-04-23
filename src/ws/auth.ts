import type { Socket } from 'socket.io';
import type { ExtendedError } from 'socket.io';
import { tokenService } from '../services/token.service.js';

const makeErr = (code: string): ExtendedError => {
  const err = new Error(code) as ExtendedError;
  err.data = { code };
  return err;
};

/**
 * Socket.IO handshake middleware. Accepts the same access JWT the HTTP
 * routes use, sourced from `auth.token` (preferred) or the Authorization
 * header (fallback for clients that can't set auth payloads).
 */
export const wsAuth = (socket: Socket, next: (err?: ExtendedError) => void): void => {
  const authPayload = socket.handshake.auth as { token?: string } | undefined;
  const headerToken = socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
  const token = authPayload?.token ?? headerToken;

  if (!token) {
    next(makeErr('missing_token'));
    return;
  }

  try {
    const payload = tokenService.verifyAccessToken(token);
    socket.data.user = {
      id: payload.sub,
      email: payload.email,
      username: payload.username,
    };
    next();
  } catch {
    next(makeErr('invalid_token'));
  }
};
