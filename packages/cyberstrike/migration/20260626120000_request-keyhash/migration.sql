-- request-keyhash: explicit unified structural identity for the dedup gate.
--
-- key_hash materializes the implicit dedup key (method ∥ origin ∥ normalized_path
-- ∥ (op_key_hash ?? body_hash ?? "") ∥ query_hash) so the ingest gate can become
-- an atomic ON CONFLICT upsert instead of a racy exists()→add() pair. Legacy rows
-- leave key_hash NULL; the unique index treats NULLs as distinct, so they never
-- collide and continue to dedup via the body/query/op fallback in Request.exists.
ALTER TABLE request ADD COLUMN key_hash TEXT;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS request_keyhash_idx ON request(session_id, key_hash);
