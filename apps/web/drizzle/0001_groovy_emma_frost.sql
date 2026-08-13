CREATE TABLE `config_classes` (
	`config_id` text NOT NULL,
	`class` text NOT NULL,
	PRIMARY KEY(`config_id`, `class`),
	FOREIGN KEY (`config_id`) REFERENCES `configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `config_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`version_label` text NOT NULL,
	`changelog_md` text DEFAULT '' NOT NULL,
	`lint_report_json` text NOT NULL,
	`lint_status` text NOT NULL,
	`metadata_json` text NOT NULL,
	`preview_key_json` text,
	`zip_r2_key` text NOT NULL,
	`total_size_bytes` integer NOT NULL,
	`file_count` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `versions_config` ON `config_versions` (`config_id`);--> statement-breakpoint
CREATE TABLE `configs` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`description_md` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`latest_version_id` text,
	`download_count` integer DEFAULT 0 NOT NULL,
	`install_count` integer DEFAULT 0 NOT NULL,
	`preview_tier` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `configs_slug_unique` ON `configs` (`slug`);--> statement-breakpoint
CREATE INDEX `configs_status_created` ON `configs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `configs_status_downloads` ON `configs` (`status`,`download_count`);--> statement-breakpoint
CREATE INDEX `configs_category` ON `configs` (`category`);--> statement-breakpoint
CREATE TABLE `download_events` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`kind` text NOT NULL,
	`ip_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_version` ON `download_events` (`version_id`);--> statement-breakpoint
CREATE INDEX `events_created` ON `download_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`install_path` text NOT NULL,
	`r2_key` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `config_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_version` ON `files` (`version_id`);--> statement-breakpoint
CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`type` text NOT NULL,
	`r2_key` text,
	`youtube_id` text,
	`width` integer,
	`height` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`config_id`) REFERENCES `configs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_config` ON `media` (`config_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`reporter_id` text,
	`reason` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_by` text,
	`resolved_at` integer,
	FOREIGN KEY (`config_id`) REFERENCES `configs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_status` ON `reports` (`status`);