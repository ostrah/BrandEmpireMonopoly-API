import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export const passwordService = {
  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, SALT_ROUNDS);
  },

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  },
};
