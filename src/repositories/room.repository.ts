import type { PoolClient } from 'pg';
import { pool } from '../db/pool.js';
import type { Room, RoomWithPlayers } from '../models/room.model.js';

const WITH_PLAYERS_FRAGMENT = `
  SELECT
    r.*,
    COALESCE(
      JSON_AGG(
        JSON_BUILD_OBJECT(
          'user_id',   u.id,
          'username',  u.username,
          'joined_at', rp.joined_at
        ) ORDER BY rp.joined_at
      ) FILTER (WHERE u.id IS NOT NULL),
      '[]'::json
    ) AS players,
    COUNT(rp.user_id)::int AS player_count
  FROM rooms r
  LEFT JOIN room_players rp ON rp.room_id = r.id
  LEFT JOIN users u ON u.id = rp.user_id
`;

export const roomRepository = {
  async createTx(
    client: PoolClient,
    input: {
      code: string;
      name: string;
      host_id: string;
      is_private: boolean;
      max_players: number;
    }
  ): Promise<Room> {
    const { rows } = await client.query<Room>(
      `INSERT INTO rooms (code, name, host_id, is_private, max_players)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [input.code, input.name, input.host_id, input.is_private, input.max_players]
    );
    return rows[0]!;
  },

  async listPublicWaiting(): Promise<RoomWithPlayers[]> {
    const { rows } = await pool.query<RoomWithPlayers>(
      `${WITH_PLAYERS_FRAGMENT}
       WHERE r.is_private = FALSE AND r.status = 'waiting'
       GROUP BY r.id
       ORDER BY r.created_at DESC`
    );
    return rows;
  },

  async findById(id: string): Promise<RoomWithPlayers | null> {
    const { rows } = await pool.query<RoomWithPlayers>(
      `${WITH_PLAYERS_FRAGMENT}
       WHERE r.id = $1
       GROUP BY r.id`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByCodeForUpdate(client: PoolClient, code: string): Promise<Room | null> {
    const { rows } = await client.query<Room>(
      'SELECT * FROM rooms WHERE code = $1 FOR UPDATE',
      [code]
    );
    return rows[0] ?? null;
  },

  async findByIdForUpdate(client: PoolClient, id: string): Promise<Room | null> {
    const { rows } = await client.query<Room>(
      'SELECT * FROM rooms WHERE id = $1 FOR UPDATE',
      [id]
    );
    return rows[0] ?? null;
  },

  async playerCount(client: PoolClient, room_id: string): Promise<number> {
    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*)::int AS count FROM room_players WHERE room_id = $1',
      [room_id]
    );
    return Number(rows[0]?.count ?? 0);
  },

  async isPlayer(client: PoolClient, room_id: string, user_id: string): Promise<boolean> {
    const { rows } = await client.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2) AS exists',
      [room_id, user_id]
    );
    return rows[0]?.exists ?? false;
  },

  /** Non-transactional membership check — used by the WS layer for subscribe authorization. */
  async isPlayerDirect(room_id: string, user_id: string): Promise<boolean> {
    const { rows } = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2) AS exists',
      [room_id, user_id]
    );
    return rows[0]?.exists ?? false;
  },

  async addPlayerTx(client: PoolClient, room_id: string, user_id: string): Promise<void> {
    await client.query(
      'INSERT INTO room_players (room_id, user_id) VALUES ($1, $2)',
      [room_id, user_id]
    );
  },

  async removePlayer(client: PoolClient, room_id: string, user_id: string): Promise<void> {
    await client.query(
      'DELETE FROM room_players WHERE room_id = $1 AND user_id = $2',
      [room_id, user_id]
    );
  },

  async getOldestOtherPlayer(
    client: PoolClient,
    room_id: string,
    except_user_id: string
  ): Promise<string | null> {
    const { rows } = await client.query<{ user_id: string }>(
      `SELECT user_id FROM room_players
       WHERE room_id = $1 AND user_id != $2
       ORDER BY joined_at ASC
       LIMIT 1`,
      [room_id, except_user_id]
    );
    return rows[0]?.user_id ?? null;
  },

  async updateHost(client: PoolClient, room_id: string, new_host_id: string): Promise<void> {
    await client.query('UPDATE rooms SET host_id = $2 WHERE id = $1', [room_id, new_host_id]);
  },

  async deleteRoom(client: PoolClient, room_id: string): Promise<void> {
    await client.query('DELETE FROM rooms WHERE id = $1', [room_id]);
  },
};
