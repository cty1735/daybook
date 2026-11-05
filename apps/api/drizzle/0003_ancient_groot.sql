CREATE TABLE `admin_session` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `admin_session_admin_ix` ON `admin_session` (`admin_id`);--> statement-breakpoint
CREATE INDEX `admin_session_expires_ix` ON `admin_session` (`expires_at`);--> statement-breakpoint
CREATE TABLE `admin_user` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_login_at` integer,
	`last_login_ip` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_user_username_uq` ON `admin_user` (`username`);