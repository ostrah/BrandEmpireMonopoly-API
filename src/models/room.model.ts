export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Room {
  id: string;
  code: string;
  name: string;
  host_id: string;
  is_private: boolean;
  max_players: number;
  status: RoomStatus;
  created_at: Date;
  updated_at: Date;
}

export interface RoomPlayerPublic {
  user_id: string;
  username: string;
  joined_at: Date;
}

export interface RoomWithPlayers extends Room {
  player_count: number;
  players: RoomPlayerPublic[];
}
