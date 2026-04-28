-- normalize-proto: 4-tier path normalizer schema
--
-- Adds origin/host/port/scheme/site/canonical_path/template_id/norm_source to
-- the request table, plus a new endpoint_template table for tier-2 cache, plus
-- a soft template_id pointer on web_function. All new columns are NULLABLE —
-- legacy rows stay untouched and the new code falls back gracefully on NULL.
--
-- See db.ts:130 reconcile() for the schema-driven safety net that re-applies
-- any ALTER skipped by drizzle's single-statement limitation.

ALTER TABLE request ADD COLUMN scheme TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN host TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN port INTEGER;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN origin TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN site TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN canonical_path TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN template_id TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN norm_source TEXT;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS endpoint_template (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  method TEXT NOT NULL,
  template TEXT NOT NULL,
  segment_count INTEGER NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  hit_count INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS endpoint_template_session_idx
  ON endpoint_template(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS endpoint_template_lookup_idx
  ON endpoint_template(session_id, origin, method, segment_count);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS endpoint_template_unique_idx
  ON endpoint_template(session_id, origin, method, template);
--> statement-breakpoint

ALTER TABLE web_function ADD COLUMN template_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS request_template_idx ON request(template_id);
