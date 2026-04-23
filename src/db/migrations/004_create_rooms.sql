CREATE TABLE IF NOT EXISTS rooms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code        CHAR(6) UNIQUE NOT NULL,
  name        VARCHAR(64) NOT NULL,
  host_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_private  BOOLEAN NOT NULL DEFAULT FALSE,
  max_players SMALLINT NOT NULL DEFAULT 4 CHECK (max_players BETWEEN 2 AND 4),
  status      VARCHAR(16) NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'playing', 'finished')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS room_players (
  room_id   UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_rooms_code           ON rooms(code);
CREATE INDEX IF NOT EXISTS idx_rooms_public_waiting ON rooms(created_at DESC)
  WHERE is_private = FALSE AND status = 'waiting';
CREATE INDEX IF NOT EXISTS idx_room_players_room    ON room_players(room_id);
CREATE INDEX IF NOT EXISTS idx_room_players_user    ON room_players(user_id);

DROP TRIGGER IF EXISTS rooms_updated_at ON rooms;
CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
