import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './helpers/app.js';
import { createAndVerifyUser, authHeader, type TestUser } from './helpers/users.js';

const createRoom = async (host: TestUser, overrides: Record<string, unknown> = {}) => {
  const res = await request(app)
    .post('/api/rooms')
    .set(authHeader(host))
    .send({
      name: 'Test Room',
      is_private: false,
      max_players: 4,
      ...overrides,
    });
  if (res.status !== 201) {
    throw new Error(
      `create room failed: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return res.body.room as {
    id: string;
    code: string;
    name: string;
    host_id: string;
    is_private: boolean;
    max_players: number;
    status: string;
    players: Array<{ user_id: string; username: string }>;
  };
};

describe('rooms: auth gating', () => {
  it('requires auth on POST /api/rooms', async () => {
    const res = await request(app)
      .post('/api/rooms')
      .send({ name: 'x', is_private: false, max_players: 4 });
    expect(res.status).toBe(401);
  });

  it('allows anonymous GET /api/rooms (lobby list)', async () => {
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.rooms)).toBe(true);
  });
});

describe('rooms: create', () => {
  it('creates a room with the host as the first player', async () => {
    const host = await createAndVerifyUser();
    const room = await createRoom(host);

    expect(room.host_id).toBe(host.id);
    expect(room.status).toBe('waiting');
    expect(room.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.user_id).toBe(host.id);
  });

  it('private rooms do not appear in the public lobby', async () => {
    const host = await createAndVerifyUser();
    const publicRoom = await createRoom(host, { name: 'Public', is_private: false });
    await createRoom(host, { name: 'Secret', is_private: true });

    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(200);
    const ids = (res.body.rooms as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(publicRoom.id);
    expect((res.body.rooms as Array<{ is_private: boolean }>).every((r) => !r.is_private)).toBe(true);
  });

  it('non-member cannot fetch a private room (404 to avoid leaking existence)', async () => {
    const host = await createAndVerifyUser();
    const outsider = await createAndVerifyUser();
    const room = await createRoom(host, { is_private: true });

    const res = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(outsider));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('room_not_found');
  });
});

describe('rooms: join', () => {
  it('adds a player and reflects them in the room payload', async () => {
    const host = await createAndVerifyUser();
    const joiner = await createAndVerifyUser();
    const room = await createRoom(host);

    const res = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: room.code });

    expect(res.status).toBe(200);
    expect(res.body.room.players).toHaveLength(2);
    const userIds = res.body.room.players.map((p: { user_id: string }) => p.user_id);
    expect(userIds).toContain(host.id);
    expect(userIds).toContain(joiner.id);
  });

  it('returns 409 room_full when capacity is exhausted', async () => {
    const host = await createAndVerifyUser();
    const a = await createAndVerifyUser();
    const b = await createAndVerifyUser();
    const c = await createAndVerifyUser();
    const room = await createRoom(host, { max_players: 2 });

    const r1 = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(a))
      .send({ code: room.code });
    expect(r1.status).toBe(200);

    const r2 = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(b))
      .send({ code: room.code });
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('room_full');

    // Sanity: third attempt also rejected.
    const r3 = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(c))
      .send({ code: room.code });
    expect(r3.status).toBe(409);
  });

  it('returns 409 already_in_room on double join', async () => {
    const host = await createAndVerifyUser();
    const joiner = await createAndVerifyUser();
    const room = await createRoom(host);

    await request(app)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: room.code })
      .expect(200);

    const r = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: room.code });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('already_in_room');
  });

  it('returns 404 for an unknown code', async () => {
    const joiner = await createAndVerifyUser();
    const res = await request(app)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: 'ZZZZZZ' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('room_not_found');
  });

  it('concurrent join race: only capacity-many succeed, the rest get room_full', async () => {
    // Regression test for the FOR UPDATE + capacity check inside withTransaction.
    // Before the lock, two concurrent joins could both pass the capacity check
    // and both INSERT into room_players, overflowing max_players.
    const host = await createAndVerifyUser();
    const p1 = await createAndVerifyUser();
    const p2 = await createAndVerifyUser();
    const p3 = await createAndVerifyUser();
    const room = await createRoom(host, { max_players: 2 });

    // Room starts with 1 player (host) and capacity 2 → exactly 1 slot free.
    // Three concurrent joiners should produce: 1× 200, 2× 409 room_full.
    const results = await Promise.all(
      [p1, p2, p3].map((u) =>
        request(app).post('/api/rooms/join').set(authHeader(u)).send({ code: room.code })
      )
    );

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409]);

    for (const r of results) {
      if (r.status === 409) {
        expect(r.body.error.code).toBe('room_full');
      }
    }

    // Final authoritative read — exactly max_players rows.
    const fetched = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(host));
    expect(fetched.status).toBe(200);
    expect(fetched.body.room.players).toHaveLength(2);
  });
});

describe('rooms: leave', () => {
  it('non-host leave just removes the player', async () => {
    const host = await createAndVerifyUser();
    const joiner = await createAndVerifyUser();
    const room = await createRoom(host);
    await request(app)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: room.code })
      .expect(200);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/leave`)
      .set(authHeader(joiner));
    expect(res.status).toBe(200);

    const fetched = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(host));
    expect(fetched.body.room.players).toHaveLength(1);
    expect(fetched.body.room.host_id).toBe(host.id);
  });

  it('host leaving with other players triggers host handover', async () => {
    const host = await createAndVerifyUser();
    const other = await createAndVerifyUser();
    const room = await createRoom(host);
    await request(app)
      .post('/api/rooms/join')
      .set(authHeader(other))
      .send({ code: room.code })
      .expect(200);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/leave`)
      .set(authHeader(host));
    expect(res.status).toBe(200);

    const fetched = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(other));
    expect(fetched.status).toBe(200);
    expect(fetched.body.room.host_id).toBe(other.id);
    expect(fetched.body.room.players).toHaveLength(1);
  });

  it('last player leaving deletes the room', async () => {
    const host = await createAndVerifyUser();
    const room = await createRoom(host);

    const res = await request(app)
      .post(`/api/rooms/${room.id}/leave`)
      .set(authHeader(host));
    expect(res.status).toBe(200);

    const fetched = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(host));
    expect(fetched.status).toBe(404);
  });
});

describe('rooms: close', () => {
  it('host can close the room', async () => {
    const host = await createAndVerifyUser();
    const room = await createRoom(host);

    const res = await request(app)
      .delete(`/api/rooms/${room.id}`)
      .set(authHeader(host));
    expect(res.status).toBe(200);

    const fetched = await request(app)
      .get(`/api/rooms/${room.id}`)
      .set(authHeader(host));
    expect(fetched.status).toBe(404);
  });

  it('non-host cannot close the room', async () => {
    const host = await createAndVerifyUser();
    const other = await createAndVerifyUser();
    const room = await createRoom(host);
    await request(app)
      .post('/api/rooms/join')
      .set(authHeader(other))
      .send({ code: room.code })
      .expect(200);

    const res = await request(app)
      .delete(`/api/rooms/${room.id}`)
      .set(authHeader(other));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_host');
  });
});
