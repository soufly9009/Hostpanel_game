CREATE TABLE `job_runs` (
	`name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer,
	`last_result` text
);
--> statement-breakpoint
ALTER TABLE `servers` ADD `suspend_reason` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `expires_at` integer;
--> statement-breakpoint
UPDATE `servers` SET `expires_at` = unixepoch() + 604800 WHERE `expires_at` IS NULL;
