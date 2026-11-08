CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`film_id` text NOT NULL,
	`script_version` integer NOT NULL,
	`note` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` integer NOT NULL,
	FOREIGN KEY (`film_id`) REFERENCES `films`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_film_version_unique` ON `revisions` (`film_id`,`script_version`);--> statement-breakpoint
DROP INDEX `deliverables_film_variant_unique`;--> statement-breakpoint
ALTER TABLE `deliverables` ADD `script_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `deliverables_film_version_variant_unique` ON `deliverables` (`film_id`,`script_version`,`variant_key`);