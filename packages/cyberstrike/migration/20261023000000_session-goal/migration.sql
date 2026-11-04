CREATE TABLE `goal` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE CASCADE,
  `objective` text NOT NULL,
  `status` text NOT NULL,
  `execution` text NOT NULL,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goal_session_idx` ON `goal` (`session_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_current_idx` ON `goal` (`session_id`) WHERE `status` NOT IN ('completed', 'dropped');
--> statement-breakpoint
CREATE TABLE `goal_usage` (
  `goal_id` text NOT NULL REFERENCES `goal`(`id`) ON DELETE CASCADE,
  `id` text NOT NULL,
  PRIMARY KEY (`goal_id`, `id`)
);
