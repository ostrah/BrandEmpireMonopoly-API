import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createWsServer } from '../src/ws/server.js';
import { resetIo } from '../src/ws/events.js';
import { createAndVerifyUser, authHeader } from './helpers/users.js';

// A single live HTTP+WS server per test file. Socket.IO events rely on
// real transport (not supertest's in-process agent), so we bind to a random
// port on 127.0.0.1. Room.service emits via a module-level `io` singleton,
// which createWsServer registers here — that means HTTP calls made through
// any channel (supertest-app or baseUrl) will fan out to the live WS clients.
let httpServer: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  httpServer = http.createServer(app);
  createWsServer(httpServer);
  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  resetIo();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

const connect = (token?: string): ClientSocket =>
  ioClient(baseUrl, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...(token ? { auth: { token } } : {}),
  });

const awaitConnect = (socket: ClientSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });

const awaitConnectError = (socket: ClientSocket): Promise<Error> =>
  new Promise((resolve) => {
    socket.once('connect_error', (err) => resolve(err));
  });

const emitWithAck = <T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> =>
  new Promise((resolve) => {
    socket.emit(event, payload, (resp: T) => resolve(resp));
  });

const waitForEvent = <T>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('ws: auth gating', () => {
  it('rejects connection when token is missing', async () => {
    const client = connect();
    const err = await awaitConnectError(client);
    expect(err.message).toBe('missing_token');
    client.close();
  });

  it('rejects connection when token is invalid', async () => {
    const client = connect('not-a-real-jwt');
    const err = await awaitConnectError(client);
    expect(err.message).toBe('invalid_token');
    client.close();
  });

  it('accepts connection with a valid access token', async () => {
    const user = await createAndVerifyUser();
    const client = connect(user.accessToken);
    await awaitConnect(client);
    expect(client.connected).toBe(true);
    client.close();
  });
});

describe('ws: room subscribe authorization', () => {
  it('rejects room:subscribe from a non-member with not_a_member', async () => {
    const host = await createAndVerifyUser();
    const outsider = await createAndVerifyUser();

    const created = await request(baseUrl)
      .post('/api/rooms')
      .set(authHeader(host))
      .send({ name: 'Gated', is_private: false, max_players: 4 });
    expect(created.status).toBe(201);
    const roomId = created.body.room.id as string;

    const client = connect(outsider.accessToken);
    await awaitConnect(client);

    const ack = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
      client,
      'room:subscribe',
      { roomId }
    );
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('not_a_member');

    client.close();
  });

  it('accepts room:subscribe from a member', async () => {
    const host = await createAndVerifyUser();
    const created = await request(baseUrl)
      .post('/api/rooms')
      .set(authHeader(host))
      .send({ name: 'Mine', is_private: false, max_players: 4 });
    const roomId = created.body.room.id as string;

    const client = connect(host.accessToken);
    await awaitConnect(client);

    const ack = await emitWithAck<{ ok: boolean }>(client, 'room:subscribe', { roomId });
    expect(ack.ok).toBe(true);

    client.close();
  });

  it('rejects room:subscribe with a malformed payload', async () => {
    const user = await createAndVerifyUser();
    const client = connect(user.accessToken);
    await awaitConnect(client);

    const ack = await emitWithAck<{ ok: boolean; error?: { code: string } }>(
      client,
      'room:subscribe',
      { roomId: 'not-a-uuid' }
    );
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('invalid_payload');

    client.close();
  });
});

describe('ws: broadcast on room mutations', () => {
  it('delivers room:player_joined to a subscribed host when someone joins via HTTP', async () => {
    // Regression test for the core Stage-1 plumbing: HTTP mutation in
    // room.service → emitRoomEvent → io.to(channel).emit → client receives.
    const host = await createAndVerifyUser();
    const joiner = await createAndVerifyUser();

    const created = await request(baseUrl)
      .post('/api/rooms')
      .set(authHeader(host))
      .send({ name: 'Live', is_private: false, max_players: 4 });
    const room = created.body.room as { id: string; code: string };

    const hostSocket = connect(host.accessToken);
    await awaitConnect(hostSocket);

    const sub = await emitWithAck<{ ok: boolean }>(hostSocket, 'room:subscribe', {
      roomId: room.id,
    });
    expect(sub.ok).toBe(true);

    // Arm the listener BEFORE issuing the HTTP call that triggers the emit —
    // otherwise a fast server could beat us to deliver.
    const eventPromise = waitForEvent<{
      type: string;
      roomId: string;
      player: { user_id: string; username: string };
    }>(hostSocket, 'room:player_joined');

    const joinRes = await request(baseUrl)
      .post('/api/rooms/join')
      .set(authHeader(joiner))
      .send({ code: room.code });
    expect(joinRes.status).toBe(200);

    const event = await eventPromise;
    expect(event.type).toBe('room:player_joined');
    expect(event.roomId).toBe(room.id);
    expect(event.player.user_id).toBe(joiner.id);
    expect(event.player.username).toBe(joiner.username);

    hostSocket.close();
  });

  it('delivers room:host_changed then completes when the host leaves', async () => {
    const host = await createAndVerifyUser();
    const other = await createAndVerifyUser();

    const created = await request(baseUrl)
      .post('/api/rooms')
      .set(authHeader(host))
      .send({ name: 'Handover', is_private: false, max_players: 4 });
    const room = created.body.room as { id: string; code: string };

    await request(baseUrl)
      .post('/api/rooms/join')
      .set(authHeader(other))
      .send({ code: room.code })
      .expect(200);

    const otherSocket = connect(other.accessToken);
    await awaitConnect(otherSocket);
    const sub = await emitWithAck<{ ok: boolean }>(otherSocket, 'room:subscribe', {
      roomId: room.id,
    });
    expect(sub.ok).toBe(true);

    const hostChangedPromise = waitForEvent<{ type: string; roomId: string; hostId: string }>(
      otherSocket,
      'room:host_changed'
    );

    const leaveRes = await request(baseUrl)
      .post(`/api/rooms/${room.id}/leave`)
      .set(authHeader(host));
    expect(leaveRes.status).toBe(200);

    const event = await hostChangedPromise;
    expect(event.roomId).toBe(room.id);
    expect(event.hostId).toBe(other.id);

    otherSocket.close();
  });

  it('delivers room:closed when the host closes the room', async () => {
    const host = await createAndVerifyUser();
    const other = await createAndVerifyUser();

    const created = await request(baseUrl)
      .post('/api/rooms')
      .set(authHeader(host))
      .send({ name: 'Closing', is_private: false, max_players: 4 });
    const room = created.body.room as { id: string; code: string };

    await request(baseUrl)
      .post('/api/rooms/join')
      .set(authHeader(other))
      .send({ code: room.code })
      .expect(200);

    const otherSocket = connect(other.accessToken);
    await awaitConnect(otherSocket);
    await emitWithAck(otherSocket, 'room:subscribe', { roomId: room.id });

    const closedPromise = waitForEvent<{ type: string; roomId: string }>(
      otherSocket,
      'room:closed'
    );

    await request(baseUrl)
      .delete(`/api/rooms/${room.id}`)
      .set(authHeader(host))
      .expect(200);

    const event = await closedPromise;
    expect(event.roomId).toBe(room.id);

    otherSocket.close();
  });
});
