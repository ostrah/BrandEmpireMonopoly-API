import { Router, type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/env.js';
import { authService, type RequestMeta } from '../services/auth.service.js';
import { userRepository } from '../repositories/user.repository.js';
import { toPublicUser } from '../models/user.model.js';
import { HttpError } from '../utils/httpError.js';
import { validateBody, validateQuery } from '../middleware/validate.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { verifyOrigin } from '../middleware/verifyOrigin.middleware.js';
import { rateLimit, keyByIpAndBodyField } from '../middleware/rateLimit.middleware.js';
import {
  registerSchema,
  loginSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailQuerySchema,
} from '../schemas/auth.schemas.js';

const REFRESH_COOKIE = 'be_refresh';

const getMeta = (req: Request): RequestMeta => ({
  userAgent: (req.headers['user-agent'] ?? null) as string | null,
  ip: req.ip ?? null,
});

const setRefreshCookie = (res: Response, token: string, expiresAt: Date) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });
};

const clearRefreshCookie = (res: Response) => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
  });
};

const rlRegister = rateLimit({ name: 'register', max: 3, windowMs: 15 * 60_000 });
const rlLogin = rateLimit({
  name: 'login',
  max: 5,
  windowMs: 15 * 60_000,
  keyFn: keyByIpAndBodyField('email'),
});
const rlForgot = rateLimit({
  name: 'forgot',
  max: 3,
  windowMs: 15 * 60_000,
  keyFn: keyByIpAndBodyField('email'),
});
const rlResend = rateLimit({
  name: 'resend',
  max: 3,
  windowMs: 15 * 60_000,
  keyFn: keyByIpAndBodyField('email'),
});

export const authRouter = Router();

authRouter.post(
  '/register',
  rlRegister,
  validateBody(registerSchema),
  async (req, res, next) => {
    try {
      const { user } = await authService.register(req.body, getMeta(req));
      res.status(201).json({
        user,
        message: 'Registration successful. Please check your email to verify your account.',
      });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/login',
  rlLogin,
  validateBody(loginSchema),
  async (req, res, next) => {
    try {
      const { user, tokens } = await authService.login(req.body, getMeta(req));
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.json({ user, accessToken: tokens.accessToken });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/logout',
  verifyOrigin,
  async (req, res, next) => {
    try {
      const presented = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? undefined;
      await authService.logout(presented);
      clearRefreshCookie(res);
      res.json({ success: true });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/refresh',
  verifyOrigin,
  async (req, res, next) => {
    try {
      const presented = req.cookies?.[REFRESH_COOKIE] as string | undefined;
      if (!presented) throw HttpError.unauthorized('missing_refresh', 'Refresh cookie missing');

      const { user, tokens } = await authService.refresh(presented, getMeta(req));
      setRefreshCookie(res, tokens.refreshToken, tokens.refreshExpiresAt);
      res.json({ user, accessToken: tokens.accessToken });
    } catch (err) {
      // If refresh failed, ensure the stale cookie is cleared.
      clearRefreshCookie(res);
      next(err);
    }
  }
);

authRouter.get(
  '/verify-email',
  validateQuery(verifyEmailQuerySchema),
  async (req, res, next) => {
    try {
      const token = String(req.query.token);
      const { user } = await authService.verifyEmail(token);
      res.json({ user, message: 'Email verified' });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/resend-verification',
  rlResend,
  validateBody(resendVerificationSchema),
  async (req, res, next) => {
    try {
      await authService.resendVerification(req.body.email);
      res.json({ message: 'If an account exists and is not verified, a verification email has been sent.' });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/forgot-password',
  rlForgot,
  validateBody(forgotPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.requestPasswordReset(req.body.email);
      res.json({ message: 'If an account exists, a reset link has been sent.' });
    } catch (err) { next(err); }
  }
);

authRouter.post(
  '/reset-password',
  validateBody(resetPasswordSchema),
  async (req, res, next) => {
    try {
      await authService.resetPassword(req.body);
      res.json({ message: 'Password updated. Please log in again.' });
    } catch (err) { next(err); }
  }
);

authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) throw HttpError.unauthorized();
    const user = await userRepository.findById(req.user.id);
    if (!user) throw HttpError.unauthorized('user_gone', 'User no longer exists');
    res.json({ user: toPublicUser(user) });
  } catch (err) { next(err); }
});
