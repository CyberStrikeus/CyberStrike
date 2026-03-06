-- Credential Headers Refactor Migration
-- Converts old type/value based credentials to new headers-based format

-- Step 1: Create new table with new schema
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

-- Step 2: Migrate data from old table to new
INSERT INTO web_credential_new (id, session_id, label, headers, container_id, role_id, time_created, time_updated)
SELECT 
  id,
  session_id,
  label,
  CASE 
    WHEN type = 'bearer' OR type = 'jwt' THEN json_object('Authorization', 'Bearer ' || value)
    WHEN type = 'cookie' THEN json_object('Cookie', value)
    WHEN type = 'api_key' THEN json_object('X-API-Key', value)
    WHEN type = 'basic' THEN json_object('Authorization', 'Basic ' || value)
    ELSE json_object('Authorization', value)
  END,
  NULL,
  role_id,
  time_created,
  time_updated
FROM web_credential;

-- Step 3: Drop old table
DROP TABLE web_credential;

-- Step 4: Rename new table to original name
ALTER TABLE web_credential_new RENAME TO web_credential;

-- Step 5: Create indexes
CREATE INDEX IF NOT EXISTS web_credential_session_idx ON web_credential(session_id);
CREATE INDEX IF NOT EXISTS web_credential_container_idx ON web_credential(container_id);
