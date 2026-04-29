-- Add Browser-Agent Enrichment Fields to Request Table
-- These fields are sent by browser-agent (not Firefox extension) and provide
-- UI context and role-based access information for vulnerability analysis.
-- All nullable — Firefox extension requests will have NULL values.

ALTER TABLE request ADD COLUMN trigger_element TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN element_roles TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN ui_context TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN page_url TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN page_visited_by TEXT;
