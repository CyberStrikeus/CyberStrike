CREATE TABLE IF NOT EXISTS engagement_event (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  session_id TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  correlation_id TEXT,
  parent_id TEXT,
  data TEXT NOT NULL,
  time_created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engagement_event_project_time_idx ON engagement_event(project_id, time_created);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engagement_event_session_time_idx ON engagement_event(session_id, time_created);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS engagement_event_correlation_idx ON engagement_event(correlation_id);
