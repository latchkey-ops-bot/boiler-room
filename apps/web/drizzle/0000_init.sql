CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`clerk_user_id` text,
	`clerk_org_id` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "accounts_one_owner" CHECK(("accounts"."kind" = 'user' and "accounts"."clerk_user_id" is not null and "accounts"."clerk_org_id" is null) or ("accounts"."kind" = 'org' and "accounts"."clerk_org_id" is not null and "accounts"."clerk_user_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_clerk_user_id_unique` ON `accounts` (`clerk_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_clerk_org_id_unique` ON `accounts` (`clerk_org_id`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`script_version` integer NOT NULL,
	`decision` text NOT NULL,
	`note` text,
	`chosen_hook` text,
	`chosen_cta` text,
	`formats_json` text,
	`decided_by` text NOT NULL,
	`decided_at` integer NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_film_version_unique` ON `approvals` (`film_id`,`script_version`);--> statement-breakpoint
CREATE TABLE `deliverables` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`variant_key` text NOT NULL,
	`format` text NOT NULL,
	`hook_id` text,
	`cta_id` text,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`r2_key` text,
	`bytes` integer,
	`duration_seconds` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliverables_film_variant_unique` ON `deliverables` (`film_id`,`variant_key`);--> statement-breakpoint
CREATE TABLE `film_events` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`pipeline_event_id` text NOT NULL,
	`seq` integer NOT NULL,
	`at` integer NOT NULL,
	`agent` text NOT NULL,
	`kind` text NOT NULL,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`message` text NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `film_events_pipeline_event_unique` ON `film_events` (`film_id`,`pipeline_event_id`);--> statement-breakpoint
CREATE INDEX `film_events_film_seq_idx` ON `film_events` (`film_id`,`seq`);--> statement-breakpoint
CREATE TABLE `films` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`pipeline` text NOT NULL,
	`pipeline_run_id` text,
	`script_version` integer DEFAULT 0 NOT NULL,
	`campaign_json` text,
	`chosen_hook` text,
	`chosen_cta` text,
	`formats_json` text DEFAULT '[]' NOT NULL,
	`showcase_opt_in` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `films_account_created_idx` ON `films` (`account_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `films_showcase_idx` ON `films` (`showcase_opt_in`,`status`);