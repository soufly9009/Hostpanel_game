CREATE TABLE `db_deploy_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`actor` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`pending` text,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'investigating' NOT NULL,
	`impact` text DEFAULT 'degraded' NOT NULL,
	`components` text NOT NULL,
	`message` text,
	`is_public` integer DEFAULT false NOT NULL,
	`maintenance_id` text,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`maintenance_id`) REFERENCES `maintenance_events`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `incidents_status_idx` ON `incidents` (`status`);--> statement-breakpoint
CREATE TABLE `ip_addresses` (
	`id` text PRIMARY KEY NOT NULL,
	`network_id` text NOT NULL,
	`address` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`mode` text,
	`server_id` text,
	`site_id` text,
	`reason` text,
	`comment` text,
	`assigned_at` integer,
	`released_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`network_id`) REFERENCES `ip_networks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ip_addresses_net_addr_idx` ON `ip_addresses` (`network_id`,`address`);--> statement-breakpoint
CREATE INDEX `ip_addresses_status_idx` ON `ip_addresses` (`status`);--> statement-breakpoint
CREATE INDEX `ip_addresses_server_idx` ON `ip_addresses` (`server_id`);--> statement-breakpoint
CREATE TABLE `ip_networks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cidr` text NOT NULL,
	`family` text NOT NULL,
	`gateway` text,
	`dns_servers` text NOT NULL,
	`vlan` integer,
	`bridge` text,
	`node` text,
	`range_start` text,
	`range_end` text,
	`mode` text DEFAULT 'static' NOT NULL,
	`dhcp_available` integer DEFAULT false NOT NULL,
	`client_assignable` integer DEFAULT false NOT NULL,
	`allow_overlap` integer DEFAULT false NOT NULL,
	`notes` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ip_networks_name_idx` ON `ip_networks` (`name`);--> statement-breakpoint
CREATE TABLE `ipam_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`address_id` text,
	`network_id` text,
	`address` text,
	`action` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`actor` text NOT NULL,
	`result` text DEFAULT 'ok' NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `ipamlogs_address_idx` ON `ipam_logs` (`address_id`);--> statement-breakpoint
CREATE INDEX `ipamlogs_created_idx` ON `ipam_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `maintenance_events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`impact` text DEFAULT 'none' NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`timezone` text DEFAULT 'Europe/Paris' NOT NULL,
	`services` text NOT NULL,
	`nodes` text NOT NULL,
	`site_ids` text NOT NULL,
	`customer_message` text,
	`is_public` integer DEFAULT false NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published_at` integer,
	`notify_before_minutes` integer DEFAULT 1440 NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `maintenance_status_idx` ON `maintenance_events` (`status`);--> statement-breakpoint
CREATE INDEX `maintenance_starts_idx` ON `maintenance_events` (`starts_at`);--> statement-breakpoint
CREATE TABLE `migration_announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`scheduled_at` integer NOT NULL,
	`estimated_minutes` integer DEFAULT 15 NOT NULL,
	`impact` text,
	`services` text NOT NULL,
	`reason` text,
	`source_node` text,
	`target_node` text,
	`server_ids` text NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`notify_before_minutes` integer DEFAULT 1440 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`result` text,
	`finished_at` integer,
	`created_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `migann_status_idx` ON `migration_announcements` (`status`);--> statement-breakpoint
CREATE INDEX `migann_scheduled_idx` ON `migration_announcements` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `migration_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`announcement_id` text NOT NULL,
	`kind` text NOT NULL,
	`revision` integer NOT NULL,
	`recipients` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`announcement_id`) REFERENCES `migration_announcements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mignotif_unique_idx` ON `migration_notifications` (`announcement_id`,`kind`,`revision`);--> statement-breakpoint
ALTER TABLE `plans` ADD `network_modes` text DEFAULT 'dhcp' NOT NULL;--> statement-breakpoint
ALTER TABLE `servers` ADD `network_mode` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `network_id` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `ip_address_id` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `previous_ip_address_id` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `net_sync_state` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `net_error` text;--> statement-breakpoint
ALTER TABLE `servers` ADD `net_updated_at` integer;