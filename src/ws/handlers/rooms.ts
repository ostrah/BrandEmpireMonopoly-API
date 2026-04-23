import type { Server as IOServer, Socket } from 'socket.io';
import { z } from 'zod';
import { roomRepository } from '../../repositories/room.repository.js';
import { roomChannel } from '../events.js';
import { logger } from '../../utils/logger.js';

const roomPayloadSchema = z.object({ roomId: z.string().uuid() });

type Ack = (
  resp: { ok: true } | { ok: false; error: { code: string; message?: string } }
) => void;

const safeAck = (ack: Ack | undefined, resp: Parameters<Ack>[0]): void => {
  if (typeof ack === 'function') ack(resp);
};

export const registerRoomHandlers = (_io: IOServer, socket: Socket): void => {
  const userId = socket.data.user?.id;
  if (!userId) {
    // Should not happen — wsAuth rejects before we reach here.
    socket.disconnect(true);
    return;
  }

  socket.on('room:subscribe', async (payload: unknown, ack?: Ack) => {
    const parsed = roomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      safeAck(ack, { ok: false, error: { code: 'invalid_payload' } });
      return;
    }

    try {
      const isMember = await roomRepository.isPlayerDirect(parsed.data.roomId, userId);
      if (!isMember) {
        safeAck(ack, { ok: false, error: { code: 'not_a_member' } });
        return;
      }

      await socket.join(roomChannel(parsed.data.roomId));
      logger.info('WS subscribed', { userId, roomId: parsed.data.roomId });
      safeAck(ack, { ok: true });
    } catch (err) {
      logger.error('room:subscribe failed', err);
      safeAck(ack, { ok: false, error: { code: 'internal_error' } });
    }
  });

  socket.on('room:unsubscribe', async (payload: unknown, ack?: Ack) => {
    const parsed = roomPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      safeAck(ack, { ok: false, error: { code: 'invalid_payload' } });
      return;
    }
    await socket.leave(roomChannel(parsed.data.roomId));
    safeAck(ack, { ok: true });
  });

  socket.on('disconnect', (reason) => {
    logger.debug('WS disconnected', { userId, reason });
  });
};
