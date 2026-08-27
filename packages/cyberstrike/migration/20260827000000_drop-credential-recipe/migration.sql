-- Drop the unused `recipe` column from web_credential (credential-recipe feature removed).
-- SQLite has no safe "DROP COLUMN IF EXISTS": a plain DROP COLUMN would fail on fresh
-- DBs, where `recipe` never existed (it was only ever added at runtime by the schema
-- reconcile, now removed). Rebuild the table with an explicit column list instead — this
-- is idempotent whether or not `recipe` is present and mirrors the proven web_credential
-- rebuild in 20260225000001_credential-headers-refactor.

-- Step 1: Create the table without `recipe`
CREATE TABLE IF NOT EXISTS web_credential_new (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  container_id TEXT,
  role_id TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
-- Step 2: Copy every column except `recipe`
INSERT INTO web_credential_new (id, session_id, label, headers, container_id, role_id, time_created, time_updated)
SELECT id, session_id, label, headers, container_id, role_id, time_created, time_updated FROM web_credential;
--> statement-breakpoint
-- Step 3: Drop the old table
DROP TABLE web_credential;
--> statement-breakpoint
-- Step 4: Rename into place
ALTER TABLE web_credential_new RENAME TO web_credential;
--> statement-breakpoint
-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS web_credential_session_idx ON web_credential(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_credential_container_idx ON web_credential(container_id);
