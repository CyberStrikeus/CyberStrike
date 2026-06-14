-- methodology-engine: Intelligence, coverage, chain detection, agent performance
--
-- 6 tables for the CyberStrike methodology engine:
-- intel_entry, vrt_check, methodology_phase, chain_candidate,
-- agent_performance, validation_violation.
-- All session-scoped with FK cascade deletes.

CREATE TABLE IF NOT EXISTS intel_entry (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  severity TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  source TEXT,
  asset TEXT NOT NULL,
  confidence_level TEXT,
  tags TEXT,
  chain_potential TEXT,
  related_entries TEXT,
  status TEXT NOT NULL,
  position INTEGER NOT NULL,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS intel_entry_session_idx ON intel_entry(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS intel_entry_type_idx ON intel_entry(type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS intel_entry_asset_idx ON intel_entry(asset);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS intel_entry_compound_idx ON intel_entry(session_id, asset, type);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS vrt_check (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  intel_entry_id TEXT NOT NULL REFERENCES intel_entry(id) ON DELETE CASCADE,
  vrt_category TEXT NOT NULL,
  vrt_path TEXT,
  status TEXT NOT NULL,
  technique TEXT,
  tested_by TEXT,
  tested_at INTEGER,
  evidence TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vrt_check_entry_idx ON vrt_check(intel_entry_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vrt_check_session_idx ON vrt_check(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vrt_check_status_idx ON vrt_check(session_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS methodology_phase (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  phase_id TEXT NOT NULL,
  status TEXT NOT NULL,
  completion_evidence TEXT,
  deliverable_count INTEGER NOT NULL DEFAULT 0,
  block_reason TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS methodology_phase_session_idx ON methodology_phase(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS methodology_phase_lookup_idx ON methodology_phase(session_id, phase_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS chain_candidate (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  entry_ids TEXT,
  entry_titles TEXT,
  assets TEXT,
  expected_impact TEXT,
  severity TEXT,
  testing_plan TEXT,
  status TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  detected_at INTEGER,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chain_candidate_session_idx ON chain_candidate(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chain_candidate_status_idx ON chain_candidate(session_id, status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS agent_performance (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  findings_reported INTEGER NOT NULL DEFAULT 0,
  chains_contributed INTEGER NOT NULL DEFAULT 0,
  turns_used INTEGER NOT NULL DEFAULT 0,
  success_rate REAL NOT NULL DEFAULT 0,
  coverage_contributed INTEGER NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0,
  average_evidence_quality REAL NOT NULL DEFAULT 0,
  performance_score REAL NOT NULL DEFAULT 0,
  morale INTEGER NOT NULL DEFAULT 70,
  motivation TEXT,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_performance_session_idx ON agent_performance(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_performance_agent_idx ON agent_performance(session_id, agent_name);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS validation_violation (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  gate TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  affected_entry_id TEXT,
  affected_asset TEXT,
  field TEXT,
  expected_value TEXT,
  actual_value TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  time_created INTEGER NOT NULL,
  time_updated INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS validation_violation_session_idx ON validation_violation(session_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS validation_violation_severity_idx ON validation_violation(session_id, severity);
