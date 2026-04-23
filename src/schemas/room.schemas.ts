import { z } from 'zod';

export const createRoomSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(64, 'Name must be at most 64 characters').trim(),
  is_private: z.boolean().default(false),
  max_players: z.number().int().min(2).max(4).default(4),
});

export const joinByCodeSchema = z.object({
  code: z.string().length(6, 'Room code must be exactly 6 characters').toUpperCase(),
});

export type CreateRoomBody = z.infer<typeof createRoomSchema>;
export type JoinByCodeBody = z.infer<typeof joinByCodeSchema>;
