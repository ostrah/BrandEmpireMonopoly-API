import type { Server as IOServer } from 'socket.io';

/** Single instance, assigned once in createWsServer. Null before WS init (e.g. in HTTP-only tests). */
let io: IOServer | null = null;

export const setIo = (instance: IOServer): void => {
  io = instance;
};

export const getIo = (): IOServer | null => io;

/** Clears the singleton — tests use this between suites to avoid leaking handles. */
export const resetIo = (): void => {
  io = null;
};

export const roomChannel = (roomId: string): string => `room:${roomId}`;

export interface RoomPlayerPayload {
  user_id: string;
  username: string;
}

export type RoomEventName =
  | 'room:player_joined'
  | 'room:player_left'
  | 'room:host_changed'
  | 'room:closed';

export type RoomEvent =
  | { type: 'room:player_joined'; roomId: string; player: RoomPlayerPayload }
  | { type: 'room:player_left';   roomId: string; userId: string }
  | { type: 'room:host_changed';  roomId: string; hostId: string }
  | { type: 'room:closed';        roomId: string };

/**
 * Broadcast a domain event to every socket currently subscribed to the room's
 * channel. With the Redis adapter this fans out across all API instances;
 * without it, it's a local-only emit. Either way, no-op if WS hasn't been
 * initialised (e.g. in unit tests that never spin up an HTTP server).
 */
export const emitRoomEvent = (event: RoomEvent): void => {
  if (!io) return;
  io.to(roomChannel(event.roomId)).emit(event.type, event);
};
