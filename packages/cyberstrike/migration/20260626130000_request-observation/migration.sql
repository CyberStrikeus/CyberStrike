-- request-observation: per-credential observed values for access-control testing.
--
-- Append-only fact stream, one row per (session, key_hash, credential, value_hash).
-- The unique index makes the observe() write an idempotent ON CONFLICT DO NOTHING
-- upsert (no read-modify-write race under bursty crawls). op_group_hash anchors
-- operation-level aggregation (IDOR/BFLA/mass-assignment).
CREATE TABLE IF NOT EXISTS request_observation (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  op_group_hash TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  request_id TEXT REFERENCES request(id) ON DELETE CASCADE,
  credential_id TEXT,
  value_hash TEXT NOT NULL,
  slots TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS request_observation_dedup_idx ON request_observation(session_id, key_hash, credential_id, value_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_observation_op_idx ON request_observation(session_id, op_group_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_observation_key_idx ON request_observation(session_id, key_hash);
