-- Epic 2 (#64, #66): add organization_id / area_id to existing tables and
-- backfill existing single-tenant data onto a default Organization + default
-- Area per Event (O15). Strategy: ADD COLUMN nullable -> backfill -> SET NOT NULL
-- -> add FKs. Runs cleanly on both a fresh (empty) DB and the live single-tenant DB.

-- 1. Add columns as NULLABLE so existing rows survive the ALTER.
ALTER TABLE "events" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "queue_items" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "play_next_slot" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "organization_id" uuid;--> statement-breakpoint

-- 2. O15 backfill — create the default Organization for existing data if needed.
INSERT INTO "organizations" ("id", "slug", "name")
SELECT '00000000-0000-0000-0000-000000000050', 'demo', 'Mr. DJ Demo Organization'
WHERE EXISTS (SELECT 1 FROM "events") AND NOT EXISTS (SELECT 1 FROM "organizations");--> statement-breakpoint

UPDATE "events"
SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1)
WHERE "organization_id" IS NULL;--> statement-breakpoint

-- Ensure each Event has a default Area (skips events already seeded with one).
INSERT INTO "areas" ("event_id", "organization_id", "name", "is_default")
SELECT e."id", e."organization_id", 'Main Floor', true
FROM "events" e
WHERE NOT EXISTS (
  SELECT 1 FROM "areas" a WHERE a."event_id" = e."id" AND a."is_default" = true
);--> statement-breakpoint

UPDATE "queue_items" qi
SET "area_id" = (
  SELECT a."id" FROM "areas" a WHERE a."event_id" = qi."event_id" AND a."is_default" = true LIMIT 1
)
WHERE "area_id" IS NULL;--> statement-breakpoint

UPDATE "play_next_slot" pns
SET "area_id" = (
  SELECT a."id" FROM "areas" a WHERE a."event_id" = pns."event_id" AND a."is_default" = true LIMIT 1
)
WHERE "area_id" IS NULL;--> statement-breakpoint

UPDATE "wallets"
SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1)
WHERE "organization_id" IS NULL;--> statement-breakpoint

UPDATE "credit_transactions"
SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1)
WHERE "organization_id" IS NULL;--> statement-breakpoint

-- 3. Enforce NOT NULL now that data is backfilled.
ALTER TABLE "events" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "queue_items" ALTER COLUMN "area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "play_next_slot" ALTER COLUMN "area_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- 4. Foreign keys + uniqueness.
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_next_slot" ADD CONSTRAINT "play_next_slot_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_next_slot" ADD CONSTRAINT "play_next_slot_area_id_unique" UNIQUE("area_id");
