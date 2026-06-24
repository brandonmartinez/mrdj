ALTER TABLE "wallets" DROP CONSTRAINT "wallets_user_id_unique";--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_org_key" UNIQUE("user_id","organization_id");