ALTER TABLE `catalog_entries` ADD `kind` text DEFAULT 'openapi_operation' NOT NULL;--> statement-breakpoint
CREATE INDEX `catalog_entries_kind_idx` ON `catalog_entries` (`kind`);