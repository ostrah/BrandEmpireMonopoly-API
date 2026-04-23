import request from 'supertest';
import { app } from './app.js';
import { extractToken, lastMailTo } from './mailbox.js';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  password: string;
  accessToken: string;
  refreshCookie: string;
  ip: string;
}

let ipCounter = 0;
const uniqueIp = (): string => {
  ipCounter += 1;
  // Pick from 10.0.0.0/8 so we never collide with real client IPs. Each test
  // user gets a distinct IP, which sidesteps in-memory rate limiting since
  // buckets are keyed by req.ip (or ip+email for login/forgot).
  return `10.${(ipCounter >> 16) & 0xff}.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`;
};

let userCounter = 0;
const uniqueSuffix = (): string => {
  userCounter += 1;
  return `${Date.now().toString(36)}${userCounter}`;
};

interface RegisterOptions {
  email?: string;
  username?: string;
  password?: string;
  ip?: string;
}

export const extractRefreshCookie = (setCookie: string[] | string | undefined): string => {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const refresh = list.find((c) => c.startsWith('be_refresh='));
  if (!refresh) {
    throw new Error(
      `No be_refresh cookie in Set-Cookie. Got: ${JSON.stringify(list)}`
    );
  }
  // Return just the "name=value" portion so it can be re-sent as Cookie header.
  return refresh.split(';')[0]!;
};

/**
 * Full signup flow: register → pull verification token from captured mail →
 * verify → login. Returns a ready-to-use user with access token and refresh cookie.
 */
export const createAndVerifyUser = async (
  opts: RegisterOptions = {}
): Promise<TestUser> => {
  const suffix = uniqueSuffix();
  const email = opts.email ?? `u_${suffix}@test.local`;
  const username = opts.username ?? `user_${suffix}`;
  const password = opts.password ?? 'Passw0rd!test';
  const ip = opts.ip ?? uniqueIp();

  const registerRes = await request(app)
    .post('/api/auth/register')
    .set('X-Forwarded-For', ip)
    .send({ email, username, password });
  if (registerRes.status !== 201) {
    throw new Error(
      `register failed: ${registerRes.status} ${JSON.stringify(registerRes.body)}`
    );
  }

  const verifyMail = lastMailTo(email);
  const verifyToken = extractToken(verifyMail.html);

  const verifyRes = await request(app)
    .get(`/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}`)
    .set('X-Forwarded-For', ip);
  if (verifyRes.status !== 200) {
    throw new Error(
      `verify-email failed: ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`
    );
  }

  const loginRes = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password });
  if (loginRes.status !== 200) {
    throw new Error(
      `login failed: ${loginRes.status} ${JSON.stringify(loginRes.body)}`
    );
  }

  const refreshCookie = extractRefreshCookie(loginRes.headers['set-cookie']);

  return {
    id: loginRes.body.user.id as string,
    email,
    username,
    password,
    accessToken: loginRes.body.accessToken as string,
    refreshCookie,
    ip,
  };
};

export const authHeader = (user: TestUser): Record<string, string> => ({
  Authorization: `Bearer ${user.accessToken}`,
  'X-Forwarded-For': user.ip,
});
