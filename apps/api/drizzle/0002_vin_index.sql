DROP INDEX "vehicles_vin_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_active_uq" ON "vehicles" USING btree ("vin") WHERE "vehicles"."vin" IS NOT NULL AND "vehicles"."status" <> 'COMPLETED';--> statement-breakpoint
CREATE INDEX "vehicles_vin_idx" ON "vehicles" USING btree ("vin");