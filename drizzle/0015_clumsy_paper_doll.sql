CREATE TABLE `cancellation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`service_type` text NOT NULL,
	`service_id` text NOT NULL,
	`service_name` text NOT NULL,
	`mode` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`handled_by` text,
	`handled_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cancellation_status_idx` ON `cancellation_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `cancellation_service_idx` ON `cancellation_requests` (`service_type`,`service_id`);--> statement-breakpoint
CREATE TABLE `canned_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_by` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`result` text NOT NULL,
	`ip_hint` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `login_events_user_idx` ON `login_events` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`user_id` text,
	`title` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_label` text DEFAULT 'TVA' NOT NULL,
	`lines` text NOT NULL,
	`notes` text,
	`valid_until` integer NOT NULL,
	`invoice_id` text,
	`created_by` text,
	`responded_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_idx` ON `quotes` (`number`);--> statement-breakpoint
CREATE INDEX `quotes_user_idx` ON `quotes` (`user_id`);--> statement-breakpoint
CREATE TABLE `referral_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`referrer_id` text NOT NULL,
	`referee_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`referrer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `referral_rewards_referee_idx` ON `referral_rewards` (`referee_id`);--> statement-breakpoint
CREATE INDEX `referral_rewards_referrer_idx` ON `referral_rewards` (`referrer_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`response_code` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_state_idx` ON `webhook_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_hook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `game_servers` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `cancel_at_period_end` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `user_agent` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `ip_hint` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `last_seen_at` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `rating` integer;--> statement-breakpoint
ALTER TABLE `tickets` ADD `rating_comment` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `rated_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `users` ADD `totp_enabled_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_codes` text;--> statement-breakpoint
ALTER TABLE `users` ADD `referral_code` text;--> statement-breakpoint
ALTER TABLE `users` ADD `referred_by` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_referral_idx` ON `users` (`referral_code`);