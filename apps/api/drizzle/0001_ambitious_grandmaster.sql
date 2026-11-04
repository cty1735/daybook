CREATE TABLE `login_attempt` (
	`username` text PRIMARY KEY NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`last_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_ip` (
	`ip` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`window_start` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `password_reset` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `password_reset_user_ix` ON `password_reset` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_recovery` (
	`user_id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `user` ADD `username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `display_username` text;--> statement-breakpoint
ALTER TABLE `user` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `last_login_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);