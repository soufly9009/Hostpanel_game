CREATE TABLE `game_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_cents` integer DEFAULT 0 NOT NULL,
	`nest_id` integer NOT NULL,
	`egg_id` integer NOT NULL,
	`egg_name` text,
	`location_id` integer NOT NULL,
	`memory_mb` integer NOT NULL,
	`disk_mb` integer NOT NULL,
	`cpu_percent` integer DEFAULT 100 NOT NULL,
	`databases` integer DEFAULT 0 NOT NULL,
	`backups` integer DEFAULT 0 NOT NULL,
	`environment` text DEFAULT '{}' NOT NULL,
	`period_days` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `game_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`name` text NOT NULL,
	`ptero_id` integer NOT NULL,
	`ptero_identifier` text NOT NULL,
	`ptero_uuid` text NOT NULL,
	`address` text,
	`suspended` integer DEFAULT false NOT NULL,
	`suspend_reason` text,
	`expires_at` integer,
	`last_renewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `game_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_servers_ptero_idx` ON `game_servers` (`ptero_id`);--> statement-breakpoint
CREATE INDEX `game_servers_user_idx` ON `game_servers` (`user_id`);