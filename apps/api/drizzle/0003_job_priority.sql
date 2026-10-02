DROP INDEX "jobs_pending_idx";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","priority","run_at","id");