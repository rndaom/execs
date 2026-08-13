CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`steam_id` text NOT NULL,
	`persona_name` text NOT NULL,
	`avatar_url` text,
	`profile_url` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`is_banned` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_login_at` integer NOT NULL,
	`persona_refreshed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_steam_id_unique` ON `users` (`steam_id`);