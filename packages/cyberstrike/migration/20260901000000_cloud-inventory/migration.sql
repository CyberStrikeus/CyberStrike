CREATE TABLE `cloud_asset` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `kind` text NOT NULL,
  `name` text NOT NULL,
  `resource_id` text,
  `subscription` text,
  `resource_group` text,
  `region` text,
  `properties` text,
  `group` text NOT NULL,
  `source_agent` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_asset_session_idx` ON `cloud_asset` (`session_id`);
--> statement-breakpoint
CREATE INDEX `cloud_asset_kind_idx` ON `cloud_asset` (`session_id`, `kind`);
--> statement-breakpoint
CREATE INDEX `cloud_asset_name_idx` ON `cloud_asset` (`session_id`, `name`);
--> statement-breakpoint
CREATE INDEX `cloud_asset_group_idx` ON `cloud_asset` (`session_id`, `group`);
--> statement-breakpoint
CREATE TABLE `cloud_edge` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `from_asset_id` text NOT NULL REFERENCES `cloud_asset`(`id`) ON DELETE cascade,
  `to_asset_id` text NOT NULL REFERENCES `cloud_asset`(`id`) ON DELETE cascade,
  `type` text NOT NULL,
  `direction` text NOT NULL DEFAULT 'outbound',
  `evidence` text,
  `severity` text,
  `source_agent` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_edge_session_idx` ON `cloud_edge` (`session_id`);
--> statement-breakpoint
CREATE INDEX `cloud_edge_from_idx` ON `cloud_edge` (`from_asset_id`);
--> statement-breakpoint
CREATE INDEX `cloud_edge_to_idx` ON `cloud_edge` (`to_asset_id`);
--> statement-breakpoint
CREATE INDEX `cloud_edge_type_idx` ON `cloud_edge` (`session_id`, `type`);
--> statement-breakpoint
CREATE TABLE `cloud_exposure` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL REFERENCES `session`(`id`) ON DELETE cascade,
  `asset_id` text NOT NULL REFERENCES `cloud_asset`(`id`) ON DELETE cascade,
  `type` text NOT NULL,
  `severity` text NOT NULL,
  `detail` text,
  `verified` integer NOT NULL DEFAULT 0,
  `source_agent` text,
  `time_created` integer NOT NULL,
  `time_updated` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cloud_exposure_session_idx` ON `cloud_exposure` (`session_id`);
--> statement-breakpoint
CREATE INDEX `cloud_exposure_asset_idx` ON `cloud_exposure` (`asset_id`);
--> statement-breakpoint
CREATE INDEX `cloud_exposure_severity_idx` ON `cloud_exposure` (`session_id`, `severity`);
