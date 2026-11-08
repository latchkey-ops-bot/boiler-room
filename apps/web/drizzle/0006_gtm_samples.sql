CREATE TABLE `gtm_orders` (
	`film_id` text PRIMARY KEY NOT NULL,
	`idempotency_key` text NOT NULL,
	`lead_ref` text NOT NULL,
	`budget_micro_usd` integer NOT NULL,
	`share_id` text,
	`shared_at` integer,
	`withdrawn_at` integer,
	`withdraw_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gtm_orders_idempotency_unique` ON `gtm_orders` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `gtm_orders_share_unique` ON `gtm_orders` (`share_id`);--> statement-breakpoint
CREATE TABLE `gtm_requests` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`channel` text NOT NULL,
	`share_id` text,
	`domain` text,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gtm_requests_share_idx` ON `gtm_requests` (`share_id`);--> statement-breakpoint
ALTER TABLE `films` ADD `sample` integer DEFAULT false NOT NULL;