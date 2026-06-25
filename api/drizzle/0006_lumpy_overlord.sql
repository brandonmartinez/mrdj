-- Per-area Play Next: move the play_next_slot primary key from event_id to area_id
-- so every Area owns an independent slot. event_id remains a denormalized FK column.
ALTER TABLE "play_next_slot" DROP CONSTRAINT "play_next_slot_area_id_unique";--> statement-breakpoint
ALTER TABLE "play_next_slot" DROP CONSTRAINT "play_next_slot_pkey";--> statement-breakpoint
ALTER TABLE "play_next_slot" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "play_next_slot" ADD CONSTRAINT "play_next_slot_pkey" PRIMARY KEY ("area_id");--> statement-breakpoint
CREATE INDEX "idx_play_next_slot_event" ON "play_next_slot" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "idx_queue_items_area_position" ON "queue_items" USING btree ("area_id","position");
