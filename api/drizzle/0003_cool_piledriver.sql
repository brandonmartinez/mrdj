-- Epic 4: Marketplace payments — Stripe Connect.
-- Adds connected-account state to organizations, org-scopes pricing/bundles (O9),
-- and introduces the PlatformPayment ledger + webhook idempotency guard.

CREATE TABLE "platform_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bundle_id" uuid,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"application_fee_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"credits_granted" integer NOT NULL,
	"status" text DEFAULT 'succeeded' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_payments_stripe_payment_intent_id_unique" UNIQUE("stripe_payment_intent_id"),
	CONSTRAINT "platform_payments_status_check" CHECK ("platform_payments"."status" IN ('succeeded', 'disputed', 'refunded'))
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "charges_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "payouts_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- credit_bundles: org-scope existing rows by backfilling to the oldest org, then enforce NOT NULL.
ALTER TABLE "credit_bundles" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_bundles" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE "credit_bundles" SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "credit_bundles" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint

-- pricing_config: add org scope, backfill, then move the primary key to (organization_id, key).
ALTER TABLE "pricing_config" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
UPDATE "pricing_config" SET "organization_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" ASC LIMIT 1) WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "pricing_config" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_config" DROP CONSTRAINT "pricing_config_pkey";--> statement-breakpoint
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_organization_id_key_pk" PRIMARY KEY("organization_id","key");--> statement-breakpoint

ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_payments" ADD CONSTRAINT "platform_payments_bundle_id_credit_bundles_id_fk" FOREIGN KEY ("bundle_id") REFERENCES "public"."credit_bundles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_platform_payments_org" ON "platform_payments" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "credit_bundles" ADD CONSTRAINT "credit_bundles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_config" ADD CONSTRAINT "pricing_config_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_credit_bundles_org" ON "credit_bundles" USING btree ("organization_id");
