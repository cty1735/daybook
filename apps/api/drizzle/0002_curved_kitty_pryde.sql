CREATE TABLE `admin_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`admin_name` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`detail` text,
	`ip` text,
	`user_agent` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_created_ix` ON `admin_audit_log` (`created_at`);--> statement-breakpoint
ALTER TABLE `ledger_transactions` ADD `amount` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_transactions` ADD `tx_type` text DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE `ledger_transactions` ADD `category_id` text;--> statement-breakpoint
CREATE INDEX `ledger_tx_occurred_ix` ON `ledger_transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `ledger_tx_type_ix` ON `ledger_transactions` (`tx_type`);--> statement-breakpoint
ALTER TABLE `session` ADD `impersonated_by` text;--> statement-breakpoint
ALTER TABLE `user` ADD `role` text;--> statement-breakpoint
ALTER TABLE `user` ADD `banned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_reason` text;--> statement-breakpoint
ALTER TABLE `user` ADD `ban_expires` integer;--> statement-breakpoint
UPDATE `ledger_transactions`
SET `amount` = coalesce(json_extract(`payload`, '$.amount'), 0),
    `tx_type` = coalesce(json_extract(`payload`, '$.type'), 'expense'),
    `category_id` = json_extract(`payload`, '$.categoryId');