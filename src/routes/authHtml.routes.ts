import { Router, type Response } from 'express';
import { env } from '../config/env.js';
import { authService } from '../services/auth.service.js';
import { HttpError } from '../utils/httpError.js';
import { escapeHtml } from '../utils/html.js';
import { passwordSchema } from '../schemas/auth.schemas.js';

/**
 * Minimal HTML surface for email-click flows.
 *
 * When the frontend is not yet deployed (or is temporarily unavailable), these
 * pages let email links still complete the user journey end-to-end. Once the
 * SPA has /verify-email and /reset-password routes of its own, you can switch
 * the email links back to FRONTEND_URL and delete this router.
 */
export const authHtmlRouter = Router();

const RELAXED_CSP =
  "default-src 'none'; " +
  "style-src 'unsafe-inline'; " +
  "form-action 'self'; " +
  "base-uri 'none'; " +
  "frame-ancestors 'none'";

const applyHtmlHeaders = (res: Response) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Override helmet's default CSP for these specific HTML pages.
  res.setHeader('Content-Security-Policy', RELAXED_CSP);
  // Never let a proxy/browser cache a page that carries a one-time token.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
};

const page = (title: string, body: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)} — Brand Empire Monopoly</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%);
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      padding: 24px;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(30,41,59,0.08), 0 2px 6px rgba(30,41,59,0.06);
      padding: 32px;
    }
    h1 { margin: 0 0 8px 0; font-size: 22px; }
    h2 { margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #334155; }
    p  { margin: 0 0 14px 0; line-height: 1.5; color: #334155; }
    .muted { color: #64748b; font-size: 13px; }
    .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
    label  { font-size: 13px; font-weight: 600; color: #334155; }
    input[type="password"] {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      transition: border-color 120ms;
    }
    input[type="password"]:focus { border-color: #6366f1; }
    button {
      width: 100%;
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      background: #4f46e5;
      color: #ffffff;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 120ms;
    }
    button:hover { background: #4338ca; }
    .error {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 13px;
      margin-bottom: 14px;
    }
    .success-icon {
      width: 56px; height: 56px;
      border-radius: 50%;
      background: #dcfce7;
      color: #166534;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px auto;
      font-size: 28px;
    }
    .error-icon {
      width: 56px; height: 56px;
      border-radius: 50%;
      background: #fee2e2;
      color: #991b1b;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 16px auto;
      font-size: 28px;
    }
    a.btn-link {
      display: inline-block;
      margin-top: 8px;
      padding: 10px 16px;
      border-radius: 10px;
      background: #eef2ff;
      color: #4338ca;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    .center { text-align: center; }
    .brand { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #6366f1; font-weight: 700; margin-bottom: 6px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">Brand Empire Monopoly</div>
    ${body}
  </main>
</body>
</html>`;

const successVerifyPage = (): string => page(
  'Email verified',
  `<div class="center">
    <div class="success-icon">✓</div>
    <h1>Email verified</h1>
    <p class="muted">Your account is ready. You can head back to the app and sign in.</p>
    <a class="btn-link" href="${escapeHtml(env.FRONTEND_URL)}">Open app</a>
  </div>`
);

const errorVerifyPage = (message: string): string => page(
  'Verification failed',
  `<div class="center">
    <div class="error-icon">!</div>
    <h1>Verification failed</h1>
    <p>${escapeHtml(message)}</p>
    <p class="muted">Request a new verification email from the app.</p>
    <a class="btn-link" href="${escapeHtml(env.FRONTEND_URL)}">Open app</a>
  </div>`
);

const resetFormPage = (token: string, error?: string): string => page(
  'Reset password',
  `<h1>Set a new password</h1>
   <h2>Choose something 8+ characters long.</h2>
   ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
   <form method="POST" action="/auth/reset-password" autocomplete="off">
     <input type="hidden" name="token" value="${escapeHtml(token)}" />
     <div class="field">
       <label for="password">New password</label>
       <input id="password" type="password" name="password" minlength="8" maxlength="128" required />
     </div>
     <div class="field">
       <label for="confirm">Confirm password</label>
       <input id="confirm" type="password" name="confirm" minlength="8" maxlength="128" required />
     </div>
     <button type="submit">Update password</button>
   </form>`
);

const resetSuccessPage = (): string => page(
  'Password updated',
  `<div class="center">
    <div class="success-icon">✓</div>
    <h1>Password updated</h1>
    <p class="muted">Your password has been changed. Every existing session was signed out — please log in again.</p>
    <a class="btn-link" href="${escapeHtml(env.FRONTEND_URL)}">Open app</a>
  </div>`
);

const resetErrorPage = (message: string): string => page(
  'Reset failed',
  `<div class="center">
    <div class="error-icon">!</div>
    <h1>Reset failed</h1>
    <p>${escapeHtml(message)}</p>
    <p class="muted">The link may be expired. Request a new one from the app.</p>
    <a class="btn-link" href="${escapeHtml(env.FRONTEND_URL)}">Open app</a>
  </div>`
);

const isNonEmptyToken = (raw: unknown): raw is string =>
  typeof raw === 'string' && raw.length >= 16 && raw.length <= 256;

authHtmlRouter.get('/verify-email', async (req, res) => {
  applyHtmlHeaders(res);
  const token = req.query.token;

  if (!isNonEmptyToken(token)) {
    res.status(400).send(errorVerifyPage('The verification link is malformed.'));
    return;
  }

  try {
    await authService.verifyEmail(token);
    res.status(200).send(successVerifyPage());
  } catch (err) {
    const msg = err instanceof HttpError
      ? err.message
      : 'The verification link is invalid or expired.';
    res.status(err instanceof HttpError ? err.status : 500).send(errorVerifyPage(msg));
  }
});

authHtmlRouter.get('/reset-password', (req, res) => {
  applyHtmlHeaders(res);
  const token = req.query.token;

  if (!isNonEmptyToken(token)) {
    res.status(400).send(resetErrorPage('The reset link is malformed.'));
    return;
  }

  res.status(200).send(resetFormPage(token));
});

authHtmlRouter.post('/reset-password', async (req, res) => {
  applyHtmlHeaders(res);
  const body = req.body as Record<string, unknown> | undefined;
  const token = body?.token;
  const password = body?.password;
  const confirm = body?.confirm;

  if (!isNonEmptyToken(token)) {
    res.status(400).send(resetErrorPage('The reset link is malformed.'));
    return;
  }

  if (typeof password !== 'string' || typeof confirm !== 'string') {
    res.status(400).send(resetFormPage(token, 'Both password fields are required.'));
    return;
  }

  if (password !== confirm) {
    res.status(400).send(resetFormPage(token, 'Passwords do not match.'));
    return;
  }

  const parsed = passwordSchema.safeParse(password);
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Password is invalid.';
    res.status(400).send(resetFormPage(token, first));
    return;
  }

  try {
    await authService.resetPassword({ token, password: parsed.data });
    res.status(200).send(resetSuccessPage());
  } catch (err) {
    if (err instanceof HttpError && err.code === 'invalid_token') {
      res.status(400).send(resetErrorPage('This reset link is invalid or expired.'));
      return;
    }
    res.status(500).send(resetErrorPage('Something went wrong. Please try again.'));
  }
});
