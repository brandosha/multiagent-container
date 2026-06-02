CREATE TABLE `thread_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`turn_id` text,
	`type` text NOT NULL,
	`event_json` text NOT NULL,
	`timestamp` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `thread_events_thread_id_id_idx` ON `thread_events` (`thread_id`,`id`);--> statement-breakpoint
CREATE INDEX `thread_events_thread_id_type_idx` ON `thread_events` (`thread_id`,`type`);--> statement-breakpoint
CREATE TABLE `threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`string_id` text NOT NULL,
	`codex_thread_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `threads_string_id_idx` ON `threads` (`string_id`);