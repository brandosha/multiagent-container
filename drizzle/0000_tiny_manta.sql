CREATE TABLE IF NOT EXISTS `thread_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`type` text NOT NULL,
	`event_json` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_events_thread_id_id_idx` ON `thread_events` (`thread_id`,`id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `threads` (
	`id` integer PRIMARY KEY NOT NULL,
	`codex_thread_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
