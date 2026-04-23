import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { escapeHtml } from '../utils/html.js';

let transporter: Transporter | null = null;

const getTransporter = (): Transporter => {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
};

const sendMail = async (to: string, subject: string, html: string): Promise<void> => {
  try {
    const info = await getTransporter().sendMail({
      from: env.SMTP_FROM,
      to,
      subject,
      html,
    });
    logger.info(`Mail sent to ${to}`, { subject, messageId: info.messageId });
  } catch (err) {
    logger.error(`Failed to send mail to ${to}`, err);
    throw err;
  }
};

const layout = (title: string, bodyHtml: string): string => `
<!doctype html>
<html lang="en">
  <body style="font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; background:#f6f7fb; margin:0; padding:24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">
      <tr>
        <td style="padding:28px 32px; border-bottom:1px solid #eef0f4;">
          <h1 style="margin:0; font-size:20px; color:#111;">Brand Empire Monopoly</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px; color:#222; line-height:1.5; font-size:15px;">
          <h2 style="margin:0 0 12px 0; font-size:18px;">${title}</h2>
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:16px 32px; background:#f9fafc; color:#8a8f98; font-size:12px;">
          If you did not request this email, you can safely ignore it.
        </td>
      </tr>
    </table>
  </body>
</html>
`;

const button = (href: string, label: string): string => `
  <p style="margin:20px 0;">
    <a href="${href}" style="display:inline-block; padding:12px 20px; background:#2563eb; color:#fff; text-decoration:none; border-radius:8px; font-weight:600;">${label}</a>
  </p>
  <p style="margin:0; color:#667; font-size:13px; word-break:break-all;">Or copy this link: ${href}</p>
`;

export const mailService = {
  async sendVerificationEmail(to: string, username: string, token: string): Promise<void> {
    const url = `${env.API_BASE_URL}/auth/verify-email?token=${encodeURIComponent(token)}`;
    const html = layout(
      'Confirm your email',
      `<p>Hi <b>${escapeHtml(username)}</b>,</p>
       <p>Please confirm your email address to activate your Brand Empire Monopoly account.</p>
       ${button(url, 'Verify email')}
       <p style="color:#667; font-size:13px;">This link expires in 24 hours.</p>`
    );
    await sendMail(to, 'Verify your email — Brand Empire Monopoly', html);
  },

  async sendPasswordResetEmail(to: string, username: string, token: string): Promise<void> {
    const url = `${env.API_BASE_URL}/auth/reset-password?token=${encodeURIComponent(token)}`;
    const html = layout(
      'Reset your password',
      `<p>Hi <b>${escapeHtml(username)}</b>,</p>
       <p>We received a request to reset your password. Click the button below to choose a new one.</p>
       ${button(url, 'Reset password')}
       <p style="color:#667; font-size:13px;">This link expires in 1 hour. If you did not request a reset, you can ignore this email.</p>`
    );
    await sendMail(to, 'Reset your password — Brand Empire Monopoly', html);
  },
};
