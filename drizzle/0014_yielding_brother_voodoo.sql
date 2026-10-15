CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`body` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`published_at` integer,
	`author` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `announcements_slug_idx` ON `announcements` (`slug`);--> statement-breakpoint
CREATE INDEX `announcements_pub_idx` ON `announcements` (`is_published`,`published_at`);--> statement-breakpoint
CREATE TABLE `billing_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`full_name` text,
	`company` text,
	`address1` text,
	`address2` text,
	`postal_code` text,
	`city` text,
	`country` text DEFAULT 'FR' NOT NULL,
	`vat_number` text,
	`phone` text,
	`auto_pay_with_credits` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `client_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_notes_user_idx` ON `client_notes` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`to_address` text NOT NULL,
	`template` text NOT NULL,
	`subject` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `email_queue_state_idx` ON `email_queue` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `email_queue_created_idx` ON `email_queue` (`created_at`);--> statement-breakpoint
CREATE TABLE `email_templates` (
	`key` text PRIMARY KEY NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`is_enabled` integer DEFAULT true NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`unit_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`service_type` text,
	`service_id` text,
	`kind` text DEFAULT 'custom' NOT NULL,
	`period_key` integer,
	`applied` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invoice_items_invoice_idx` ON `invoice_items` (`invoice_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `invoice_items_period_idx` ON `invoice_items` (`service_type`,`service_id`,`period_key`);--> statement-breakpoint
CREATE TABLE `invoice_sequences` (
	`key` text PRIMARY KEY NOT NULL,
	`last` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`number` text NOT NULL,
	`type` text DEFAULT 'invoice' NOT NULL,
	`user_id` text,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`subtotal_cents` integer NOT NULL,
	`tax_cents` integer NOT NULL,
	`total_cents` integer NOT NULL,
	`tax_rate_bp` integer DEFAULT 0 NOT NULL,
	`tax_label` text DEFAULT 'TVA' NOT NULL,
	`legal_mentions` text DEFAULT '[]' NOT NULL,
	`seller` text NOT NULL,
	`buyer` text NOT NULL,
	`issued_at` integer NOT NULL,
	`due_at` integer NOT NULL,
	`paid_at` integer,
	`related_invoice_id` text,
	`notes` text,
	`reminders_sent` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_idx` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `invoices_user_idx` ON `invoices` (`user_id`,`issued_at`);--> statement-breakpoint
CREATE INDEX `invoices_status_idx` ON `invoices` (`status`,`due_at`);--> statement-breakpoint
CREATE TABLE `kb_articles` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`is_published` integer DEFAULT false NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`author` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `kb_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_articles_slug_idx` ON `kb_articles` (`slug`);--> statement-breakpoint
CREATE INDEX `kb_articles_cat_idx` ON `kb_articles` (`category_id`);--> statement-breakpoint
CREATE TABLE `kb_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `kb_categories_slug_idx` ON `kb_categories` (`slug`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`invoice_id` text,
	`service_type` text NOT NULL,
	`service_id` text,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `orders_user_idx` ON `orders` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `password_resets_hash_idx` ON `password_resets` (`token_hash`);--> statement-breakpoint
CREATE INDEX `password_resets_user_idx` ON `password_resets` (`user_id`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`user_id` text,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`reference` text,
	`note` text,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `payments_invoice_idx` ON `payments` (`invoice_id`);