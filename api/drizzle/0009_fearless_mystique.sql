ALTER TABLE "platform_payments" DROP CONSTRAINT "platform_payments_status_check";--> statement-breakpoint
ALTER TABLE "platform_payments" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "platform_payments" ADD COLUMN "stripe_connected_account_id" text;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD COLUMN "refund_method" text;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD COLUMN "refunded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_refund_method_check" CHECK ("platform_payments"."refund_method" IS NULL OR "platform_payments"."refund_method" IN ('money', 'credits'));--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_status_check" CHECK ("platform_payments"."status" IN ('pending', 'succeeded', 'disputed', 'refunded'));