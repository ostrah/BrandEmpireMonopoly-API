import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { HttpError } from './utils/httpError.js';
import { authRouter } from './routes/auth.routes.js';
import { authHtmlRouter } from './routes/authHtml.routes.js';
import { roomsRouter } from './routes/rooms.routes.js';

export const createApp = () => {
  const app = express();

  // Required when behind a reverse proxy for correct req.ip / secure cookies.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  // Only needed for the small HTML reset-password form submission.
  app.use(express.urlencoded({ extended: false, limit: '10kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
  });

  app.get('/', (_req, res) => {
    res.json({ name: 'Brand Empire Monopoly API', version: '0.1.0' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/rooms', roomsRouter);
  // HTML fallback pages for email-click flows (verify-email, reset-password).
  // These handle their own CSP headers (see authHtml.routes.ts).
  app.use('/auth', authHtmlRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Not Found' } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      });
      return;
    }

    logger.error('Unhandled error', err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Internal Server Error' } });
  });

  return app;
};
