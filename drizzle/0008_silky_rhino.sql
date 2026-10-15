CREATE TABLE `activity_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`user_id` text,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `activity_created_idx` ON `activity_logs` (`created_at`);--> statement-breakpoint
CREATE INDEX `activity_user_idx` ON `activity_logs` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`href` text,
	`dedupe_key` text NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `plans` ADD `period_days` integer;--> statement-breakpoint
ALTER TABLE `plans` ADD `snapshot_limit` integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `auto_snapshot` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `ssl_last_error` text;