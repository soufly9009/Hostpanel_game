CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `system_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`level` text NOT NULL,
	`category` text NOT NULL,
	`service` text,
	`action` text,
	`result` text DEFAULT 'info' NOT NULL,
	`title` text NOT NULL,
	`message` text,
	`correlation_id` text,
	`meta` text,
	`fingerprint` text,
	`occurrences` integer DEFAULT 1 NOT NULL,
	`discord_state` text DEFAULT 'skipped' NOT NULL,
	`discord_attempts` integer DEFAULT 0 NOT NULL,
	`discord_next_attempt_at` integer,
	`discord_last_error` text,
	`discord_sent_at` integer
);
--> statement-breakpoint
CREATE INDEX `sysevents_created_idx` ON `system_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `sysevents_state_idx` ON `system_events` (`discord_state`,`discord_next_attempt_at`);--> statement-breakpoint
CREATE INDEX `sysevents_fp_idx` ON `system_events` (`fingerprint`,`created_at`);--> statement-breakpoint
CREATE INDEX `sysevents_corr_idx` ON `system_events` (`correlation_id`);