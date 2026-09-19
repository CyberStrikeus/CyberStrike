CREATE TABLE IF NOT EXISTS nmap_scan (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  profile TEXT,
  command TEXT,
  source TEXT NOT NULL,
  xml_hash TEXT NOT NULL,
  raw_xml TEXT NOT NULL,
  data TEXT NOT NULL,
  time_created INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nmap_scan_session_idx ON nmap_scan(session_id, time_created);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS nmap_scan_hash_idx ON nmap_scan(session_id, xml_hash);
