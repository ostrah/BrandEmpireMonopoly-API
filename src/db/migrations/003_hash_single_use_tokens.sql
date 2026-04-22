-- Store SHA-256 hashes of verify/reset tokens instead of the plaintext values.
-- If the database or logs leak, a hash alone cannot be used to verify an email
-- or complete a password reset — the attacker would also need the plaintext.

ALTER TABLE users RENAME COLUMN verification_token TO verification_token_hash;
ALTER TABLE users RENAME COLUMN reset_token       TO reset_token_hash;

-- Any values stored under the old scheme are now format-invalid.
UPDATE users SET verification_token_hash = NULL, reset_token_hash = NULL;

-- sha256 hex is 64 chars; keep the column large enough with a sensible bound.
ALTER TABLE users ALTER COLUMN verification_token_hash TYPE VARCHAR(64);
ALTER TABLE users ALTER COLUMN reset_token_hash       TYPE VARCHAR(64);

DROP INDEX IF EXISTS idx_users_verification_token;
DROP INDEX IF EXISTS idx_users_reset_token;

CREATE INDEX IF NOT EXISTS idx_users_verification_token_hash
  ON users(verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
  ON users(reset_token_hash)
  WHERE reset_token_hash IS NOT NULL;
