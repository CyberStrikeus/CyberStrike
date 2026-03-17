-- Add Response Fields to Request Table
-- Stores processed HTTP response data for AI analysis

ALTER TABLE request ADD COLUMN response_status INTEGER;
ALTER TABLE request ADD COLUMN response_headers TEXT;
ALTER TABLE request ADD COLUMN response_content_type TEXT;
ALTER TABLE request ADD COLUMN response_size INTEGER;
ALTER TABLE request ADD COLUMN processed_response TEXT;
