import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';
import { HttpError } from '../utils/httpError.js';
import { withTransaction } from '../db/transaction.js';
import { roomRepository } from '../repositories/room.repository.js';
import type { RoomWithPlayers } from '../models/room.model.js';
import type { CreateRoomBody } from '../schemas/room.schemas.js';
import { emitRoomEvent } from '../ws/events.js';

/**
 * Crockford-ish alphabet: no 0/O/1/I to avoid ambiguous reads.
 * 32 symbols ^ 6 positions ≈ 1.07 billion codes.
 */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_CODE_ATTEMPTS = 5;

const generateCode = (): string => {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]!).join('');
};

/** Postgres unique_violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === PG_UNIQUE_VIOLATION;

export const roomService = {
  /**
   * Create a room and add the host as its first player in a single transaction.
   *
   * Code uniqueness is guaranteed by the DB-level UNIQUE constraint — if the
   * random code collides, we catch the unique_violation and retry with a new
   * code (up to MAX_CODE_ATTEMPTS). This avoids a race window between a
   * "codeExists" pre-check and the INSERT.
   */
  async create(input: CreateRoomBody, hostId: string): Promise<RoomWithPlayers> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode();
      try {
        const roomId = await withTransaction(async (client) => {
          const room = await roomRepository.createTx(client, {
            code,
            name: input.name,
            host_id: hostId,
            is_private: input.is_private,
            max_players: input.max_players,
          });
          await roomRepository.addPlayerTx(client, room.id, hostId);
          return room.id;
        });

        logger.info('Room created', { roomId, hostId, isPrivate: input.is_private });
        const full = await roomRepository.findById(roomId);
        return full!;
      } catch (err) {
        if (isUniqueViolation(err) && attempt < MAX_CODE_ATTEMPTS - 1) {
          logger.warn('Room code collision, retrying', { attempt: attempt + 1 });
          continue;
        }
        throw err;
      }
    }
    throw new Error('Failed to generate a unique room code');
  },

  async listPublic(): Promise<RoomWithPlayers[]> {
    return roomRepository.listPublicWaiting();
  },

  async getById(id: string, requestingUserId: string): Promise<RoomWithPlayers> {
    const room = await roomRepository.findById(id);
    if (!room) throw HttpError.notFound('room_not_found', 'Room not found');

    if (room.is_private) {
      const isMember = room.players.some((p) => p.user_id === requestingUserId);
      // Return 404 rather than 403 to avoid leaking the existence of private rooms.
      if (!isMember) throw HttpError.notFound('room_not_found', 'Room not found');
    }

    return room;
  },

  async join(code: string, userId: string): Promise<RoomWithPlayers> {
    const roomId = await withTransaction(async (client) => {
      const room = await roomRepository.findByCodeForUpdate(client, code);
      if (!room) throw HttpError.notFound('room_not_found', 'Room not found');

      if (room.status !== 'waiting') {
        throw HttpError.conflict('room_not_waiting', 'Room is no longer accepting players');
      }

      const count = await roomRepository.playerCount(client, room.id);
      if (count >= room.max_players) {
        throw HttpError.conflict('room_full', 'Room is full');
      }

      const already = await roomRepository.isPlayer(client, room.id, userId);
      if (already) throw HttpError.conflict('already_in_room', 'You are already in this room');

      await roomRepository.addPlayerTx(client, room.id, userId);
      logger.info('Player joined room', { roomId: room.id, userId });
      return room.id;
    });

    const full = await roomRepository.findById(roomId);
    // Broadcast AFTER the transaction commits so subscribers only see
    // events that reflect committed state.
    const joined = full?.players.find((p) => p.user_id === userId);
    if (joined) {
      emitRoomEvent({
        type: 'room:player_joined',
        roomId,
        player: { user_id: joined.user_id, username: joined.username },
      });
    }
    return full!;
  },

  async leave(roomId: string, userId: string): Promise<void> {
    type LeaveOutcome =
      | { kind: 'left'; userId: string }
      | { kind: 'handover'; userId: string; newHostId: string }
      | { kind: 'deleted' };

    const outcome = await withTransaction<LeaveOutcome>(async (client) => {
      const room = await roomRepository.findByIdForUpdate(client, roomId);
      if (!room) throw HttpError.notFound('room_not_found', 'Room not found');

      const isMember = await roomRepository.isPlayer(client, roomId, userId);
      if (!isMember) throw HttpError.notFound('room_not_found', 'Room not found');

      if (room.status === 'playing') {
        throw HttpError.conflict('room_in_progress', 'Cannot leave a game in progress');
      }

      if (room.host_id === userId) {
        const newHost = await roomRepository.getOldestOtherPlayer(client, roomId, userId);
        if (newHost) {
          await roomRepository.updateHost(client, roomId, newHost);
          await roomRepository.removePlayer(client, roomId, userId);
          logger.info('Host left, new host assigned', { roomId, newHostId: newHost });
          return { kind: 'handover', userId, newHostId: newHost };
        }
        // Last player leaving: drop the room (room_players rows cascade).
        await roomRepository.deleteRoom(client, roomId);
        logger.info('Last player left, room deleted', { roomId });
        return { kind: 'deleted' };
      }

      await roomRepository.removePlayer(client, roomId, userId);
      logger.info('Player left room', { roomId, userId });
      return { kind: 'left', userId };
    });

    // Broadcasts happen post-commit so subscribers never observe an
    // in-flight state that could be rolled back.
    switch (outcome.kind) {
      case 'left':
        emitRoomEvent({ type: 'room:player_left', roomId, userId: outcome.userId });
        break;
      case 'handover':
        emitRoomEvent({ type: 'room:player_left', roomId, userId: outcome.userId });
        emitRoomEvent({ type: 'room:host_changed', roomId, hostId: outcome.newHostId });
        break;
      case 'deleted':
        emitRoomEvent({ type: 'room:closed', roomId });
        break;
    }
  },

  /**
   * Close a room (host-only). Locks the row, re-reads host_id, and deletes —
   * all inside one transaction, so a concurrent host handover can't slip in
   * between the check and the delete.
   */
  async close(roomId: string, userId: string): Promise<void> {
    await withTransaction(async (client) => {
      const room = await roomRepository.findByIdForUpdate(client, roomId);
      if (!room) throw HttpError.notFound('room_not_found', 'Room not found');
      if (room.host_id !== userId) {
        throw HttpError.forbidden('not_host', 'Only the host can close the room');
      }
      await roomRepository.deleteRoom(client, roomId);
    });
    logger.info('Room closed by host', { roomId, hostId: userId });
    emitRoomEvent({ type: 'room:closed', roomId });
  },
};
