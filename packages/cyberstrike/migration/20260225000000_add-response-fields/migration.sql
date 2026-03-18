-- Add Response Fields to Request Table
-- Stores processed HTTP response data for AI analysis

ALTER TABLE request ADD COLUMN response_status INTEGER;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN response_headers TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN response_content_type TEXT;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN response_size INTEGER;
--> statement-breakpoint
ALTER TABLE request ADD COLUMN processed_response TEXT;
