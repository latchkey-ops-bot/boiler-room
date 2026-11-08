CREATE TABLE `film_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`phase` text NOT NULL,
	`stage` text DEFAULT 'research' NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`script_version` integer DEFAULT 0 NOT NULL,
	`campaign_json` text,
	`approval_json` text,
	`revise_json` text,
	`computer_id` text,
	`computer_state` text DEFAULT 'none' NOT NULL,
	`computer_created_at` integer,
	`running_since` integer,
	`billed_until` integer,
	`base_snapshot_id` text NOT NULL,
	`checkpoint_id` text,
	`runner_commit` text,
	`heartbeat_at` integer,
	`launched_at` integer,
	`phase_started_at` integer,
	`phase_deadline_at` integer,
	`awaiting_since` integer,
	`queued_at` integer,
	`launch_attempts` integer DEFAULT 0 NOT NULL,
	`exited_at` integer,
	`lease_until` integer,
	`cost_crew_micro_usd` integer DEFAULT 0 NOT NULL,
	`cost_compute_micro_usd` integer DEFAULT 0 NOT NULL,
	`cost_cap_micro_usd` integer NOT NULL,
	`stop_requested_at` integer,
	`stop_reason` text,
	`failed_stage` text,
	`failure_code` text,
	`failure_message` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ended_at` integer,
	`delivered_at` integer,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `film_runs_film_unique` ON `film_runs` (`film_id`);--> statement-breakpoint
CREATE INDEX `film_runs_state_idx` ON `film_runs` (`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`run_id` text NOT NULL,
	`source` text NOT NULL,
	`source_seq` integer NOT NULL,
	`feed_seq` integer,
	`film_id` text NOT NULL,
	`at` integer NOT NULL,
	`type` text NOT NULL,
	`agent` text,
	`kind` text,
	`stage` text,
	`status` text,
	`message` text,
	`data_json` text,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `source`, `source_seq`),
	FOREIGN KEY (`run_id`) REFERENCES `film_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_feed_idx` ON `run_events` (`run_id`,`feed_seq`);--> statement-breakpoint
CREATE TABLE `run_files` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`film_id` text NOT NULL,
	`kind` text NOT NULL,
	`script_version` integer NOT NULL,
	`variant_key` text,
	`format` text,
	`name` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `film_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_files_r2_key_unique` ON `run_files` (`r2_key`);--> statement-breakpoint
CREATE INDEX `run_files_run_idx` ON `run_files` (`run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `runner_control` (
	`id` text PRIMARY KEY NOT NULL,
	`halted` integer DEFAULT false NOT NULL,
	`halted_reason` text,
	`balance_baseline_micro_usd` integer,
	`baseline_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runner_nonces` (
	`nonce` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runner_nonces_seen_idx` ON `runner_nonces` (`seen_at`);