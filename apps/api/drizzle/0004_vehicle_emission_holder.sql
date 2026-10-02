CREATE TYPE "public"."emission_class" AS ENUM('EURO_1', 'EURO_2', 'EURO_3', 'EURO_4', 'EURO_5', 'EURO_6', 'EURO_6C', 'EURO_6D_TEMP', 'EURO_6D', 'EURO_6E');--> statement-breakpoint
CREATE TYPE "public"."holder_type" AS ENUM('PRIVATE', 'COMMERCIAL');--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "emission_class" "emission_class";--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "holder_type" "holder_type";