CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text NOT NULL,
	`created_by` text,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_idx` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `coupon_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`coupon_id` text NOT NULL,
	`user_id` text NOT NULL,
	`transaction_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `coupon_redemptions_idx` ON `coupon_redemptions` (`coupon_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`description` text,
	`amount_cents` integer NOT NULL,
	`max_redemptions` integer,
	`redemptions` integer DEFAULT 0 NOT NULL,
	`per_user_limit` integer DEFAULT 1 NOT NULL,
	`starts_at` integer,
	`expires_at` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `coupons_code_idx` ON `coupons` (`code`);--> statement-breakpoint
CREATE TABLE `gift_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`expires_at` integer,
	`redeemed_by` text,
	`redeemed_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`redeemed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gift_cards_code_idx` ON `gift_cards` (`code`);--> statement-breakpoint
CREATE INDEX `gift_cards_status_idx` ON `gift_cards` (`status`);--> statement-breakpoint
CREATE TABLE `legal_acceptances` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_acceptances_idx` ON `legal_acceptances` (`user_id`,`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `legal_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`version` integer DEFAULT 0 NOT NULL,
	`acceptance_version` integer DEFAULT 0 NOT NULL,
	`requires_acceptance` integer DEFAULT false NOT NULL,
	`is_published` integer DEFAULT true NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`published_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_documents_slug_idx` ON `legal_documents` (`slug`);--> statement-breakpoint
CREATE TABLE `legal_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`heading` text NOT NULL,
	`body` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `legal_sections_doc_idx` ON `legal_sections` (`document_id`,`position`);--> statement-breakpoint
CREATE TABLE `legal_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`change_note` text,
	`major` integer DEFAULT true NOT NULL,
	`published_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `legal_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `legal_versions_idx` ON `legal_versions` (`document_id`,`version`);--> statement-breakpoint
CREATE TABLE `wallet_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`balance_after_cents` integer NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`actor` text NOT NULL,
	`reference` text,
	`idempotency_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_tx_user_idx` ON `wallet_transactions` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_tx_idem_idx` ON `wallet_transactions` (`user_id`,`idempotency_key`);--> statement-breakpoint
ALTER TABLE `users` ADD `balance_cents` integer DEFAULT 0 NOT NULL;