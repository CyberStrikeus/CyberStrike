CREATE TABLE `web_credential` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`extracted_claims` text,
	`role_id` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_credential_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `web_function` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`action_type` text NOT NULL,
	`request_id` text NOT NULL,
	`role_id` text,
	`objects` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_function_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_web_function_request_id_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `web_object` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`fields` text,
	`sensitive_fields` text,
	`id_fields` text,
	`discovered_from` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_object_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `web_object_value` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`object_id` text NOT NULL,
	`field_name` text NOT NULL,
	`value` text NOT NULL,
	`credential_id` text,
	`discovered_from` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_object_value_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_web_object_value_object_id_web_object_id_fk` FOREIGN KEY (`object_id`) REFERENCES `web_object`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `web_retest_queue` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_source` text NOT NULL,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_retest_queue_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_web_retest_queue_request_id_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `request`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `web_role` (
	`id` text PRIMARY KEY,
	`session_id` text NOT NULL,
	`name` text NOT NULL,
	`level` integer,
	`discovered_from` text,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	CONSTRAINT `fk_web_role_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `web_credential_session_idx` ON `web_credential` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_function_session_idx` ON `web_function` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_function_request_idx` ON `web_function` (`request_id`);--> statement-breakpoint
CREATE INDEX `web_object_session_idx` ON `web_object` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_object_name_idx` ON `web_object` (`session_id`,`name`);--> statement-breakpoint
CREATE INDEX `web_object_value_session_idx` ON `web_object_value` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_object_value_object_idx` ON `web_object_value` (`object_id`);--> statement-breakpoint
CREATE INDEX `web_retest_queue_session_idx` ON `web_retest_queue` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_retest_queue_status_idx` ON `web_retest_queue` (`session_id`,`status`);--> statement-breakpoint
CREATE INDEX `web_role_session_idx` ON `web_role` (`session_id`);--> statement-breakpoint
CREATE INDEX `web_role_name_idx` ON `web_role` (`session_id`,`name`);