import { pool } from '../db/pool.js';

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: Date;
}

export const refreshTokenRepository = {
  async create(input: {
    user_id: string;
    family_id: string;
    token_hash: string;
    expires_at: Date;
    user_agent?: string | null;
    ip?: string | null;
  }): Promise<RefreshTokenRow> {
    const { rows } = await pool.query<RefreshTokenRow>(
      `INSERT INTO refresh_tokens
         (user_id, family_id, token_hash, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.user_id,
        input.family_id,
        input.token_hash,
        input.expires_at,
        input.user_agent ?? null,
        input.ip ?? null,
      ]
    );
    return rows[0]!;
  },

  async findByHash(token_hash: string): Promise<RefreshTokenRow | null> {
    const { rows } = await pool.query<RefreshTokenRow>(
      'SELECT * FROM refresh_tokens WHERE token_hash = $1',
      [token_hash]
    );
    return rows[0] ?? null;
  },

  async revokeById(id: string, replaced_by: string | null = null): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = COALESCE(revoked_at, NOW()),
           replaced_by = COALESCE(replaced_by, $2)
       WHERE id = $1`,
      [id, replaced_by]
    );
  },

  async revokeFamily(family_id: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE family_id = $1
         AND revoked_at IS NULL`,
      [family_id]
    );
  },

  async revokeAllForUser(user_id: string): Promise<void> {
    await pool.query(
      `UPDATE refresh_tokens
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [user_id]
    );
  },

  async deleteExpired(): Promise<number> {
    const { rowCount } = await pool.query(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    return rowCount ?? 0;
  },
};
