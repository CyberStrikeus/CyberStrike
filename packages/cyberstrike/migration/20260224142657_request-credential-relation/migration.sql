ALTER TABLE `request` ADD `credential_id` text;--> statement-breakpoint
CREATE INDEX `request_credential_idx` ON `request` (`credential_id`);