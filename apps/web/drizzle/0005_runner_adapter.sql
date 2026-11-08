ALTER TABLE `film_runs` ADD `adapter` text;--> statement-breakpoint
ALTER TABLE `films` ADD `stand_in` integer DEFAULT false NOT NULL;