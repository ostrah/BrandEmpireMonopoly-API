import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { HttpError } from '../utils/httpError.js';
import { withTransaction } from '../db/transaction.js';
import { userRepository } from '../repositories/user.repository.js';
import { refreshTokenRepository, type RefreshTokenRow } from '../repositories/refreshToken.repository.js';
import { passwordService } from './password.service.js';
import { tokenService } from './token.service.js';
import { mailService } from './mail.service.js';
import { toPublicUser, type PublicUser, type User } from '../models/user.model.js';

const VERIFICATION_TTL = '24h';
const RESET_TTL = '1h';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface RequestMeta {
  userAgent?: string | null;
  ip?: string | null;
}

const issueTokensForLogin = async (
  user: Pick<User, 'id' | 'email' | 'username'>,
  familyId: string,
  meta: RequestMeta
): Promise<IssuedTokens> => {
  const accessToken = tokenService.signAccessToken({
    sub: user.id,
    email: user.email,
    username: user.username,
  });

  const refreshToken = tokenService.generateOpaqueToken(48);
  const refreshHash = tokenService.sha256(refreshToken);
  const refreshExpiresAt = tokenService.computeExpiry(env.JWT_REFRESH_TTL);

  await refreshTokenRepository.create({
    user_id: user.id,
    family_id: familyId,
    token_hash: refreshHash,
    expires_at: refreshExpiresAt,
    user_agent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  return { accessToken, refreshToken, refreshExpiresAt };
};

type RefreshOutcome =
  | { kind: 'ok'; user: User; tokens: IssuedTokens }
  | { kind: 'invalid' }
  | { kind: 'expired' }
  | { kind: 'reuse'; familyId: string; userId: string };

export const authService = {
  async register(
    input: { email: string; username: string; password: string },
    _meta: RequestMeta
  ): Promise<{ user: PublicUser }> {
    const email = input.email.toLowerCase().trim();
    const username = input.username.trim();

    const [byEmail, byUsername] = await Promise.all([
      userRepository.findByEmail(email),
      userRepository.findByUsername(username),
    ]);

    if (byEmail) throw HttpError.conflict('email_taken', 'Email already registered');
    if (byUsername) throw HttpError.conflict('username_taken', 'Username already taken');

    const password_hash = await passwordService.hash(input.password);
    const verificationPlain = tokenService.generateOpaqueToken(32);
    const verification_token_hash = tokenService.sha256(verificationPlain);
    const verification_expires_at = tokenService.computeExpiry(VERIFICATION_TTL);

    const user = await userRepository.create({
      email,
      password_hash,
      username,
      verification_token_hash,
      verification_expires_at,
    });

    try {
      await mailService.sendVerificationEmail(email, username, verificationPlain);
    } catch (err) {
      logger.error('Failed to send verification email on register', err);
    }

    return { user: toPublicUser(user) };
  },

  async login(
    input: { email: string; password: string },
    meta: RequestMeta
  ): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
    const user = await userRepository.findByEmail(input.email);
    if (!user) throw HttpError.unauthorized('invalid_credentials', 'Invalid email or password');

    const ok = await passwordService.verify(input.password, user.password_hash);
    if (!ok) throw HttpError.unauthorized('invalid_credentials', 'Invalid email or password');

    if (!user.email_verified) {
      throw HttpError.forbidden('email_not_verified', 'Please verify your email first');
    }

    const familyId = crypto.randomUUID();
    const tokens = await issueTokensForLogin(user, familyId, meta);
    await userRepository.touchLastLogin(user.id);

    return { user: toPublicUser(user), tokens };
  },

  async verifyEmail(presentedToken: string): Promise<{ user: PublicUser }> {
    const hash = tokenService.sha256(presentedToken);
    const user = await userRepository.findByVerificationTokenHash(hash);
    if (!user) {
      throw HttpError.badRequest('invalid_token', 'Verification token is invalid or expired');
    }

    await userRepository.markVerified(user.id);
    return { user: toPublicUser({ ...user, email_verified: true }) };
  },

  async resendVerification(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    // Intentionally silent on missing / already-verified — do not leak account state.
    if (!user || user.email_verified) return;

    const plain = tokenService.generateOpaqueToken(32);
    const hash = tokenService.sha256(plain);
    const expires = tokenService.computeExpiry(VERIFICATION_TTL);
    await userRepository.setVerificationTokenHash(user.id, hash, expires);

    try {
      await mailService.sendVerificationEmail(user.email, user.username, plain);
    } catch (err) {
      logger.error('Failed to send verification email (resend)', err);
    }
  },

  async requestPasswordReset(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email);
    // Silent on missing — do not leak account state.
    if (!user) return;

    const plain = tokenService.generateOpaqueToken(32);
    const hash = tokenService.sha256(plain);
    const expires = tokenService.computeExpiry(RESET_TTL);
    await userRepository.setResetTokenHash(user.id, hash, expires);

    try {
      await mailService.sendPasswordResetEmail(user.email, user.username, plain);
    } catch (err) {
      logger.error('Failed to send password reset email', err);
    }
  },

  async resetPassword(input: { token: string; password: string }): Promise<void> {
    const hash = tokenService.sha256(input.token);
    const user = await userRepository.findByResetTokenHash(hash);
    if (!user) throw HttpError.badRequest('invalid_token', 'Reset token is invalid or expired');

    const password_hash = await passwordService.hash(input.password);
    await userRepository.updatePassword(user.id, password_hash);
    // All existing sessions become invalid after a password reset.
    await refreshTokenRepository.revokeAllForUser(user.id);
  },

  /**
   * Atomic refresh with family-based reuse detection.
   *
   * The parent row is locked via `SELECT ... FOR UPDATE`, so two concurrent
   * refresh requests carrying the same token serialize: the first rotates and
   * revokes the parent; the second then reads `revoked_at IS NOT NULL` and
   * falls into the reuse branch, revoking the family. This preserves the
   * one-time-use guarantee against racing clients.
   */
  async refresh(
    presentedToken: string,
    meta: RequestMeta
  ): Promise<{ user: PublicUser; tokens: IssuedTokens }> {
    const hash = tokenService.sha256(presentedToken);

    const outcome: RefreshOutcome = await withTransaction(async (client) => {
      const { rows } = await client.query<RefreshTokenRow>(
        'SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [hash]
      );
      const row = rows[0];
      if (!row) return { kind: 'invalid' };

      if (row.revoked_at) {
        // Reuse detected — revoke the whole family (this device chain).
        // Happens inside the same transaction so the revoke is atomic with the read.
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = NOW()
           WHERE family_id = $1
             AND revoked_at IS NULL`,
          [row.family_id]
        );
        return { kind: 'reuse', familyId: row.family_id, userId: row.user_id };
      }

      if (row.expires_at.getTime() <= Date.now()) {
        return { kind: 'expired' };
      }

      const { rows: userRows } = await client.query<User>(
        'SELECT * FROM users WHERE id = $1',
        [row.user_id]
      );
      const user = userRows[0];
      if (!user) return { kind: 'invalid' };

      const newToken = tokenService.generateOpaqueToken(48);
      const newHash = tokenService.sha256(newToken);
      const newExpiresAt = tokenService.computeExpiry(env.JWT_REFRESH_TTL);

      const { rows: createdRows } = await client.query<RefreshTokenRow>(
        `INSERT INTO refresh_tokens
           (user_id, family_id, token_hash, expires_at, user_agent, ip)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          user.id,
          row.family_id,
          newHash,
          newExpiresAt,
          meta.userAgent ?? null,
          meta.ip ?? null,
        ]
      );
      const created = createdRows[0]!;

      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(),
             replaced_by = $2
         WHERE id = $1`,
        [row.id, created.id]
      );

      const accessToken = tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        username: user.username,
      });

      return {
        kind: 'ok',
        user,
        tokens: {
          accessToken,
          refreshToken: newToken,
          refreshExpiresAt: newExpiresAt,
        },
      };
    });

    switch (outcome.kind) {
      case 'invalid':
        throw HttpError.unauthorized('invalid_refresh', 'Invalid refresh token');
      case 'expired':
        throw HttpError.unauthorized('refresh_expired', 'Refresh token expired');
      case 'reuse':
        logger.warn('Refresh token reuse detected — revoked family', {
          userId: outcome.userId,
          familyId: outcome.familyId,
        });
        throw HttpError.unauthorized('refresh_reuse', 'Refresh token reuse detected');
      case 'ok':
        return { user: toPublicUser(outcome.user), tokens: outcome.tokens };
    }
  },

  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    const hash = tokenService.sha256(presentedToken);
    const row = await refreshTokenRepository.findByHash(hash);
    if (!row || row.revoked_at) return;
    await refreshTokenRepository.revokeById(row.id);
  },
};
