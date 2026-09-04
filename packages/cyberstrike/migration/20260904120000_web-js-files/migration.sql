-- web-js: JS files seen during capture (script responses). The request table holds only
-- analysis-relevant endpoints (JS is never ingested as a request row), so JS URLs are persisted
-- here — one row per (session, url) — so the panel/TUI can list them durably and a later agent can
-- pull + review each body (analyzed flags the ones it has processed).
CREATE TABLE IF NOT EXISTS web_js (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  origin TEXT,
  analyzed INTEGER,
  discovered_from TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS web_js_session_idx ON web_js(session_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS web_js_url_idx ON web_js(session_id, url);
