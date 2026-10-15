CREATE TABLE `app_installs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`app_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`log` text,
	`requested_by` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `app_installs_server_idx` ON `app_installs` (`server_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `app_installs_status_idx` ON `app_installs` (`status`);