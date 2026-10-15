CREATE TABLE `proxmox_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`actor` text,
	`action` text NOT NULL,
	`method` text NOT NULL,
	`path` text NOT NULL,
	`status` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `proxmox_logs_created_idx` ON `proxmox_logs` (`created_at`);