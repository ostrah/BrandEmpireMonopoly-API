-- Make rooms.host_id cascade-delete when the host user is removed.
-- Without ON DELETE CASCADE, deleting a user with active rooms would fail
-- with a foreign key violation; room_players already cascades, so this keeps
-- the two sides of ownership consistent.

ALTER TABLE rooms
  DROP CONSTRAINT IF EXISTS rooms_host_id_fkey;

ALTER TABLE rooms
  ADD CONSTRAINT rooms_host_id_fkey
  FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE;
