CREATE TABLE `permission_saved` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`action` text NOT NULL,
	`resource` text NOT NULL,
	`time_created` integer NOT NULL,
	`time_updated` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permission_saved_project_action_resource_idx` ON `permission_saved` (`project_id`,`action`,`resource`);
