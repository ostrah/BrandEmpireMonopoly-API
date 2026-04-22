import { pool } from '../db/pool.js';
import type { User } from '../models/user.model.js';

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    const { rows } = await pool.query<User>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0] ?? null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await pool.query<User>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    return rows[0] ?? null;
  },

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await pool.query<User>(
      'SELECT * FROM users WHERE username = $1',
      [username]
    );
    return rows[0] ?? null;
  },

  async findByVerificationTokenHash(tokenHash: string): Promise<User | null> {
    const { rows } = await pool.query<User>(
      `SELECT * FROM users
       WHERE verification_token_hash = $1
         AND verification_expires_at > NOW()`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  async findByResetTokenHash(tokenHash: string): Promise<User | null> {
    const { rows } = await pool.query<User>(
      `SELECT * FROM users
       WHERE reset_token_hash = $1
         AND reset_expires_at > NOW()`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  async create(input: {
    email: string;
    password_hash: string;
    username: string;
    verification_token_hash: string;
    verification_expires_at: Date;
  }): Promise<User> {
    const { rows } = await pool.query<User>(
      `INSERT INTO users
         (email, password_hash, username, verification_token_hash, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        input.email.toLowerCase(),
        input.password_hash,
        input.username,
        input.verification_token_hash,
        input.verification_expires_at,
      ]
    );
    return rows[0]!;
  },

  async markVerified(userId: string): Promise<void> {
    await pool.query(
      `UPDATE users
       SET email_verified = TRUE,
           verification_token_hash = NULL,
           verification_expires_at = NULL
       WHERE id = $1`,
      [userId]
    );
  },

  async setVerificationTokenHash(
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await pool.query(
      `UPDATE users
       SET verification_token_hash = $2,
           verification_expires_at = $3
       WHERE id = $1`,
      [userId, tokenHash, expiresAt]
    );
  },

  async setResetTokenHash(
    userId: string,
    tokenHash: string,
    expiresAt: Date
  ): Promise<void> {
    await pool.query(
      `UPDATE users
       SET reset_token_hash = $2,
           reset_expires_at = $3
       WHERE id = $1`,
      [userId, tokenHash, expiresAt]
    );
  },

  async updatePassword(userId: string, password_hash: string): Promise<void> {
    await pool.query(
      `UPDATE users
       SET password_hash = $2,
           reset_token_hash = NULL,
           reset_expires_at = NULL
       WHERE id = $1`,
      [userId, password_hash]
    );
  },

  async touchLastLogin(userId: string): Promise<void> {
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [userId]);
  },
};
