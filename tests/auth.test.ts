import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/app.js';
import { createAndVerifyUser, extractRefreshCookie } from './helpers/users.js';
import { lastMailTo, extractToken, mailbox } from './helpers/mailbox.js';

describe('auth: register + verify', () => {
  it('registers a new user and sends a verification email with a single-use token', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', '10.10.0.1')
      .send({
        email: 'alice@test.local',
        username: 'alice',
        password: 'Passw0rd!1',
      });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('alice@test.local');
    expect(res.body.user.email_verified).toBe(false);
    // Access token is NOT issued before verification.
    expect(res.body.accessToken).toBeUndefined();

    const mail = lastMailTo('alice@test.local');
    expect(mail.subject).toMatch(/verify/i);
    const token = extractToken(mail.html);
    expect(token.length).toBeGreaterThan(20);

    const verify = await request(app).get(
      `/api/auth/verify-email?token=${encodeURIComponent(token)}`
    );
    expect(verify.status).toBe(200);
    expect(verify.body.user.email_verified).toBe(true);

    // Second use of the same token must fail — it is consumed on first verify.
    const second = await request(app).get(
      `/api/auth/verify-email?token=${encodeURIComponent(token)}`
    );
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('invalid_token');
  });

  it('rejects duplicate email', async () => {
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', '10.11.0.1')
      .send({ email: 'dup@test.local', username: 'dup1', password: 'Passw0rd!1' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', '10.11.0.2')
      .send({ email: 'dup@test.local', username: 'dup2', password: 'Passw0rd!1' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('email_taken');
  });

  it('invalid token yields 400 invalid_token', async () => {
    // Token must pass schema validation (min 16 chars) before reaching the
    // service — otherwise we'd get validation_error, not invalid_token.
    const res = await request(app).get(
      '/api/auth/verify-email?token=00000000000000000000000000000000'
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_token');
  });
});

describe('auth: login', () => {
  it('blocks login before verification', async () => {
    const email = 'unv@test.local';
    await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', '10.12.0.1')
      .send({ email, username: 'unv', password: 'Passw0rd!1' })
      .expect(201);

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.12.0.2')
      .send({ email, password: 'Passw0rd!1' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('email_not_verified');
  });

  it('returns access token + refresh cookie after verification', async () => {
    const user = await createAndVerifyUser();
    expect(user.accessToken).toBeTruthy();
    expect(user.refreshCookie).toMatch(/^be_refresh=/);

    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(user.email);
  });

  it('rejects wrong password with invalid_credentials', async () => {
    const user = await createAndVerifyUser();

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', user.ip)
      .send({ email: user.email, password: 'WrongPass123!' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('invalid_credentials');
  });
});

describe('auth: refresh rotation', () => {
  it('rotates the refresh token and invalidates the old one', async () => {
    const user = await createAndVerifyUser();

    const r1 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie);
    expect(r1.status).toBe(200);
    expect(r1.body.accessToken).toBeTruthy();
    const newCookie = extractRefreshCookie(r1.headers['set-cookie']);
    expect(newCookie).not.toBe(user.refreshCookie);

    // The old cookie is now revoked. Using it is treated as reuse.
    const r2 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie);
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe('refresh_reuse');

    // Reuse detection revokes the family — the just-issued new cookie is now also dead.
    const r3 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', newCookie);
    expect(r3.status).toBe(401);
    expect(r3.body.error.code).toBe('refresh_reuse');
  });

  it('handles a concurrent refresh race: exactly one succeeds, the other is reuse-detected', async () => {
    // Regression test for the race we fixed with SELECT ... FOR UPDATE inside
    // withTransaction. Before the fix, both requests could read the same
    // non-revoked row and both rotate, silently breaking the one-time-use
    // guarantee. With the lock, the second request must observe revoked_at
    // and fall into the reuse branch.
    const user = await createAndVerifyUser();

    const [a, b] = await Promise.all([
      request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie),
      request(app).post('/api/auth/refresh').set('Cookie', user.refreshCookie),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    const reuseRes = a.status === 401 ? a : b;
    expect(reuseRes.body.error.code).toBe('refresh_reuse');

    const okRes = a.status === 200 ? a : b;
    // Family was revoked by the reuse branch — the "winner" token is also dead now.
    const winnerCookie = extractRefreshCookie(okRes.headers['set-cookie']);
    const r3 = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', winnerCookie);
    expect(r3.status).toBe(401);
    expect(r3.body.error.code).toBe('refresh_reuse');
  });

  it('missing refresh cookie yields 401 missing_refresh', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('missing_refresh');
  });
});

describe('auth: logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const user = await createAndVerifyUser();

    const out = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', user.refreshCookie);
    expect(out.status).toBe(200);

    const setCookie = out.headers['set-cookie'];
    const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
    const cleared = list.find((c: string) => c.startsWith('be_refresh='));
    expect(cleared).toBeTruthy();
    // clearCookie writes an empty value with an expired date.
    expect(cleared).toMatch(/be_refresh=;/);

    const r = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie);
    expect(r.status).toBe(401);
  });
});

describe('auth: password reset', () => {
  it('resets the password and revokes all existing sessions', async () => {
    const user = await createAndVerifyUser();

    const forgot = await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', user.ip)
      .send({ email: user.email });
    expect(forgot.status).toBe(200);

    const mail = lastMailTo(user.email);
    expect(mail.subject).toMatch(/reset/i);
    const resetToken = extractToken(mail.html);

    const reset = await request(app)
      .post('/api/auth/reset-password')
      .send({ token: resetToken, password: 'NewPassw0rd!' });
    expect(reset.status).toBe(200);

    // Old refresh token must be revoked after a reset.
    const r = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', user.refreshCookie);
    expect(r.status).toBe(401);

    // Old password must no longer work.
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', user.ip)
      .send({ email: user.email, password: user.password });
    expect(oldLogin.status).toBe(401);

    // New password must work.
    const newLogin = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', user.ip)
      .send({ email: user.email, password: 'NewPassw0rd!' });
    expect(newLogin.status).toBe(200);
  });

  it('forgot-password is silent on unknown email', async () => {
    mailbox.length = 0;
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', '10.99.0.1')
      .send({ email: 'nobody@test.local' });
    expect(res.status).toBe(200);
    expect(mailbox).toHaveLength(0);
  });
});
