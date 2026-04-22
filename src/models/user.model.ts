export interface User {
  id: string;
  email: string;
  password_hash: string;
  username: string;
  email_verified: boolean;
  verification_token_hash: string | null;
  verification_expires_at: Date | null;
  reset_token_hash: string | null;
  reset_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
}

/** Safe view of user for API responses — no password or tokens. */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  email_verified: boolean;
  created_at: Date;
}

export const toPublicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  username: u.username,
  email_verified: u.email_verified,
  created_at: u.created_at,
});
