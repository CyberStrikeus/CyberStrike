CREATE TABLE `request` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`method` text NOT NULL,
	`normalized_path` text NOT NULL,
	`body_hash` text,
	`query_hash` text,
	`status` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_request_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `request_session_idx` ON `request` (`session_id`);--> statement-breakpoint
CREATE INDEX `request_normalized_idx` ON `request` (`session_id`,`method`,`normalized_path`);