ALTER TABLE `films` ADD `launch_date` text;--> statement-breakpoint
ALTER TABLE `films` ADD `launch_channels_json` text DEFAULT '[]' NOT NULL;