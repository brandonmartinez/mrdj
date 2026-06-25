ALTER TABLE "credit_transactions" DROP CONSTRAINT "credit_transactions_idempotency_key_unique";--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "operation_namespace" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_idempotency_key" ON "credit_transactions" USING btree ("idempotency_key");--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_principal_operation_idem_key" UNIQUE("user_id","organization_id","operation_namespace","idempotency_key");