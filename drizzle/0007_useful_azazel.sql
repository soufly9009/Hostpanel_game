CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`domain` text NOT NULL,
	`plesk_id` integer NOT NULL,
	`ftp_login` text NOT NULL,
	`ssl_issued_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sites_domain_idx` ON `sites` (`domain`);--> statement-breakpoint
CREATE INDEX `sites_user_idx` ON `sites` (`user_id`);