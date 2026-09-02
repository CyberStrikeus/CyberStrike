-- web-ui-observation: per-credential UI-affordance observations (Faz B).
--
-- Which credential could SEE which clickable on which page. Complements
-- request_observation (which credential HIT an endpoint) — the offered-but-maybe-
-- unexercised signal for BFLA by forced browsing. Append-only; the unique index makes
-- observe() an idempotent ON CONFLICT DO NOTHING upsert. normalized_page (origin+path)
-- is the availability key; role:label matches the trigger_element wire format.
CREATE TABLE IF NOT EXISTS web_ui_observation (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  credential_id TEXT,
  normalized_page TEXT NOT NULL,
  page_url TEXT NOT NULL,
  role TEXT NOT NULL,
  label TEXT NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS web_ui_observation_dedup_idx ON web_ui_observation(session_id, normalized_page, credential_id, role, label);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_ui_observation_page_idx ON web_ui_observation(session_id, normalized_page);
