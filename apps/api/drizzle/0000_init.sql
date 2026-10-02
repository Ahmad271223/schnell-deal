CREATE TYPE "public"."auction_outcome" AS ENUM('SOLD', 'BUY_NOW', 'RESERVE_NOT_MET', 'NO_BIDS', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."auction_status" AS ENUM('DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."battery_kind" AS ENUM('ICE', 'EV', 'HYBRID');--> statement-breakpoint
CREATE TYPE "public"."bid_kind" AS ENUM('MANUAL', 'PROXY', 'BUY_NOW');--> statement-breakpoint
CREATE TYPE "public"."bid_status" AS ENUM('WINNING', 'OUTBID');--> statement-breakpoint
CREATE TYPE "public"."bidding_status" AS ENUM('VIEW_ONLY', 'CAN_BID', 'TEMP_BLOCKED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."body_type" AS ENUM('SEDAN', 'ESTATE', 'HATCHBACK', 'SUV', 'COUPE', 'CONVERTIBLE', 'VAN', 'MINIVAN', 'PICKUP', 'TRANSPORTER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."catalog_status" AS ENUM('DRAFT', 'PUBLISHED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."company_document_kind" AS ENUM('TRADE_LICENSE', 'ID_DOCUMENT', 'REGISTER_EXTRACT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."company_role" AS ENUM('OWNER', 'MANAGER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('REGISTRATION_STARTED', 'DOCUMENTS_MISSING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."company_type" AS ENUM('DEALERSHIP', 'DEALER');--> statement-breakpoint
CREATE TYPE "public"."complaint_status" AS ENUM('OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."damage_kind" AS ENUM('SCRATCH', 'DENT', 'BUMP', 'PAINT_DAMAGE', 'STONE_CHIP', 'RUST', 'CRACK', 'BREAK', 'HAIL', 'RIM_DAMAGE', 'TIRE_DAMAGE', 'GLASS_DAMAGE', 'MISSING_PART', 'INTERIOR_DAMAGE', 'MECHANICAL', 'WARNING_LIGHT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."damage_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."damage_zone" AS ENUM('FRONT_BUMPER', 'HOOD', 'WINDSHIELD', 'ROOF', 'REAR_WINDOW', 'TRUNK_LID', 'REAR_BUMPER', 'FENDER_FL', 'FENDER_FR', 'DOOR_FL', 'DOOR_FR', 'DOOR_RL', 'DOOR_RR', 'QUARTER_RL', 'QUARTER_RR', 'SILL_LEFT', 'SILL_RIGHT', 'MIRROR_LEFT', 'MIRROR_RIGHT', 'HEADLIGHT_LEFT', 'HEADLIGHT_RIGHT', 'TAILLIGHT_LEFT', 'TAILLIGHT_RIGHT', 'WHEEL_FL', 'WHEEL_FR', 'WHEEL_RL', 'WHEEL_RR', 'INTERIOR_FRONT', 'INTERIOR_REAR', 'ENGINE', 'UNDERBODY', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."deal_status" AS ENUM('CREATED', 'PAYMENT_PENDING', 'PAID', 'READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP', 'COMPLETED', 'DISPUTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."drive_type" AS ENUM('FWD', 'RWD', 'AWD');--> statement-breakpoint
CREATE TYPE "public"."dtc_status" AS ENUM('PERMANENT', 'PENDING', 'CURRENT', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."feature" AS ENUM('ENGINE_STARTS', 'DRIVABLE', 'TRANSMISSION', 'AIR_CONDITIONING', 'HEATING', 'INFOTAINMENT', 'NAVIGATION', 'WINDOWS', 'CENTRAL_LOCKING', 'LIGHTING', 'ELECTRIC_MIRRORS', 'SEAT_HEATING', 'REAR_CAMERA', 'PARKING_SENSORS', 'OTHER_EQUIPMENT');--> statement-breakpoint
CREATE TYPE "public"."feature_result" AS ENUM('OK', 'DEFECT', 'NOT_CHECKED', 'NOT_PRESENT');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID_PETROL', 'HYBRID_DIESEL', 'PLUGIN_HYBRID', 'LPG', 'CNG', 'HYDROGEN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."generated_document_kind" AS ENUM('BUYER', 'SELLER', 'INTERNAL');--> statement-breakpoint
CREATE TYPE "public"."inspection_status" AS ENUM('NEW', 'PLANNED', 'ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('BUYER_FEE', 'SELLER_FEE');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."legal_kind" AS ENUM('TERMS', 'BIDDER_TERMS', 'PRIVACY');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('ACCOUNT_APPROVED', 'ACCOUNT_REJECTED', 'ACCOUNT_BLOCKED', 'ACCOUNT_DOCUMENTS_MISSING', 'COMPANY_REGISTERED', 'INSPECTION_REQUEST_CREATED', 'INSPECTION_SCHEDULED', 'INSPECTOR_ASSIGNED', 'INSPECTION_CANCELLED', 'VEHICLE_WAITING_REVIEW', 'VEHICLE_APPROVED', 'VEHICLE_RETURNED', 'AUCTION_STARTED', 'OUTBID', 'AUCTION_ENDING_SOON', 'AUCTION_EXTENDED', 'AUCTION_WON', 'AUCTION_LOST', 'AUCTION_SOLD', 'RESERVE_NOT_MET', 'AUCTION_CANCELLED', 'DEAL_ACTION_REQUIRED', 'DEAL_STATUS_CHANGED', 'DOCUMENTS_READY', 'PICKUP_READY', 'COMPLAINT_UPDATE', 'SYSTEM_ALERT');--> statement-breakpoint
CREATE TYPE "public"."paint_point" AS ENUM('HOOD', 'FENDER_FL', 'DOOR_FL', 'DOOR_RL', 'QUARTER_RL', 'TRUNK_LID', 'QUARTER_RR', 'DOOR_RR', 'DOOR_FR', 'FENDER_FR', 'ROOF');--> statement-breakpoint
CREATE TYPE "public"."photo_quality" AS ENUM('PENDING', 'OK', 'BLURRY', 'DARK', 'BRIGHT');--> statement-breakpoint
CREATE TYPE "public"."photo_slot" AS ENUM('FRONT_LEFT_45', 'FRONT', 'FRONT_RIGHT_45', 'RIGHT_SIDE', 'REAR_RIGHT_45', 'REAR', 'REAR_LEFT_45', 'LEFT_SIDE', 'ROOF', 'ENGINE_BAY', 'TRUNK_OPEN', 'DRIVER_SEAT', 'DASHBOARD', 'ODOMETER', 'INFOTAINMENT', 'FRONT_SEATS', 'REAR_SEATS', 'HEADLINER', 'KEYS', 'VIN_PLATE', 'RIM_FL', 'RIM_FR', 'RIM_RL', 'RIM_RR', 'TIRE_FL', 'TIRE_FR', 'TIRE_RL', 'TIRE_RR', 'EXTRA', 'DAMAGE', 'PDR_LINEBOARD');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('SUPERADMIN', 'ADMIN', 'INSPECTOR', 'USER');--> statement-breakpoint
CREATE TYPE "public"."tax_type" AS ENUM('REGELBESTEUERT', 'DIFFERENZBESTEUERT');--> statement-breakpoint
CREATE TYPE "public"."tire_position" AS ENUM('FL', 'FR', 'RL', 'RR');--> statement-breakpoint
CREATE TYPE "public"."tire_season" AS ENUM('SUMMER', 'WINTER', 'ALL_SEASON');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('UPLOADED', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."vehicle_document_kind" AS ENUM('REGISTRATION_1', 'REGISTRATION_2', 'SERVICE_BOOK', 'HU_REPORT', 'APPRAISAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('DRAFT', 'INSPECTION_IN_PROGRESS', 'WAITING_REVIEW', 'REQUIRES_CORRECTION', 'APPROVED', 'SCHEDULED', 'IN_AUCTION', 'SOLD', 'UNSOLD', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."vin_check" AS ENUM('VALID', 'INVALID', 'UNVERIFIED');--> statement-breakpoint
CREATE TABLE "auction_bidders" (
	"auction_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"label" integer NOT NULL,
	"first_bid_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auction_bidders_auction_id_company_id_pk" PRIMARY KEY("auction_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "auctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"catalog_id" uuid,
	"status" "auction_status" DEFAULT 'DRAFT' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"original_ends_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"start_price" bigint NOT NULL,
	"reserve_price" bigint,
	"reserve_visible" boolean DEFAULT false NOT NULL,
	"bid_increment" bigint NOT NULL,
	"buy_now_price" bigint,
	"dealer_group_id" uuid,
	"buyer_fee_pct_bp" integer DEFAULT 0 NOT NULL,
	"buyer_fee_fixed" bigint DEFAULT 0 NOT NULL,
	"seller_fee_pct_bp" integer DEFAULT 0 NOT NULL,
	"seller_fee_fixed" bigint DEFAULT 0 NOT NULL,
	"tax_type" "tax_type" NOT NULL,
	"location_street" text,
	"location_zip" text,
	"location_city" text,
	"earliest_pickup" date,
	"anti_snipe_minutes" integer DEFAULT 0 NOT NULL,
	"current_bid" bigint,
	"current_bidder_company_id" uuid,
	"winning_bid_id" uuid,
	"bid_count" integer DEFAULT 0 NOT NULL,
	"bidder_count" integer DEFAULT 0 NOT NULL,
	"extension_count" integer DEFAULT 0 NOT NULL,
	"outcome" "auction_outcome",
	"ended_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"cancelled_reason" text,
	"ending_soon_notified_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"relisted_from_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_role" text,
	"actor_company_id" uuid,
	"event" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "battery_checks" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"kind" "battery_kind" NOT NULL,
	"voltage" numeric(6, 2),
	"test_result" text,
	"cold_cranking" integer,
	"hv_info" jsonb,
	"hv_source" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"kind" "bid_kind" NOT NULL,
	"status" "bid_status" NOT NULL,
	"sequence" integer NOT NULL,
	"server_time" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"client_request_id" text NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "catalog_vehicles" (
	"catalog_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_vehicles_catalog_id_vehicle_id_pk" PRIMARY KEY("catalog_id","vehicle_id")
);
--> statement-breakpoint
CREATE TABLE "catalogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"dealer_group_id" uuid,
	"status" "catalog_status" DEFAULT 'DRAFT' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "company_type" NOT NULL,
	"name" text NOT NULL,
	"legal_form" text NOT NULL,
	"street" text NOT NULL,
	"house_number" text NOT NULL,
	"zip" text NOT NULL,
	"city" text NOT NULL,
	"country" text DEFAULT 'DE' NOT NULL,
	"website" text,
	"register_number" text,
	"vat_id" text,
	"brands" text[] DEFAULT '{}'::text[] NOT NULL,
	"trade_type" text,
	"bank_iban" text,
	"contact_first_name" text NOT NULL,
	"contact_last_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"contact_email" text NOT NULL,
	"status" "company_status" DEFAULT 'REGISTRATION_STARTED' NOT NULL,
	"review_note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "company_document_kind" NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"company_role" "company_role" DEFAULT 'MEMBER' NOT NULL,
	"job_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"opened_by" uuid NOT NULL,
	"reason" text NOT NULL,
	"description" text NOT NULL,
	"status" "complaint_status" DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"from_status" "deal_status",
	"to_status" "deal_status" NOT NULL,
	"changed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_group_members" (
	"group_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_group_members_group_id_company_id_pk" PRIMARY KEY("group_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "dealer_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dealer_verifications" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"bidding_status" "bidding_status" DEFAULT 'VIEW_ONLY' NOT NULL,
	"blocked_until" timestamp with time zone,
	"note" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_number" text NOT NULL,
	"auction_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"seller_company_id" uuid NOT NULL,
	"buyer_company_id" uuid NOT NULL,
	"winning_bid_id" uuid NOT NULL,
	"sale_price" bigint NOT NULL,
	"vehicle_vat" bigint NOT NULL,
	"buyer_fee_net" bigint NOT NULL,
	"buyer_fee_vat" bigint NOT NULL,
	"seller_fee_net" bigint NOT NULL,
	"seller_fee_vat" bigint NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"buyer_total" bigint NOT NULL,
	"seller_payout" bigint NOT NULL,
	"tax_type" "tax_type" NOT NULL,
	"vin_snapshot" text,
	"vehicle_snapshot" jsonb NOT NULL,
	"seller_snapshot" jsonb NOT NULL,
	"buyer_snapshot" jsonb NOT NULL,
	"sold_at" timestamp with time zone NOT NULL,
	"auction_ended_at" timestamp with time zone NOT NULL,
	"origin" text NOT NULL,
	"status" "deal_status" DEFAULT 'CREATED' NOT NULL,
	"status_before_dispute" "deal_status",
	"payment_due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"code" text NOT NULL,
	"description" text,
	"status" "dtc_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"device" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"ecus" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" "generated_document_kind" NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"sha256" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"reason" text NOT NULL,
	"generated_by" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"inspector_user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"en_route_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inspection_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"vehicle_count" integer NOT NULL,
	"location_street" text NOT NULL,
	"location_zip" text NOT NULL,
	"location_city" text NOT NULL,
	"requested_date" date NOT NULL,
	"earliest_time" text NOT NULL,
	"latest_time" text NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"notes" text,
	"vehicles_drivable" boolean NOT NULL,
	"keys_available" boolean NOT NULL,
	"papers_available" boolean NOT NULL,
	"status" "inspection_status" DEFAULT 'NEW' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"cancelled_reason" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" "invoice_kind" NOT NULL,
	"number" text NOT NULL,
	"net" bigint NOT NULL,
	"vat" bigint NOT NULL,
	"gross" bigint NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "legal_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"company_id" uuid,
	"legal_document_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "legal_kind" NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"active_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maximum_bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auction_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"max_amount" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"data" jsonb,
	"read_at" timestamp with time zone,
	"email_status" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paint_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"point" "paint_point" NOT NULL,
	"value_um" integer NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdr_checks" (
	"vehicle_id" uuid PRIMARY KEY NOT NULL,
	"performed" boolean NOT NULL,
	"lineboard_photo_id" uuid,
	"dent_count" integer,
	"positions" text,
	"size" text,
	"paint_damaged" boolean,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pickups" (
	"deal_id" uuid PRIMARY KEY NOT NULL,
	"location_street" text,
	"location_zip" text,
	"location_city" text,
	"contact_name" text,
	"contact_phone" text,
	"opening_hours" text,
	"pickup_code" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"handed_over_at" timestamp with time zone,
	"handed_over_by" uuid,
	"taken_over_at" timestamp with time zone,
	"taken_over_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"keys" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tire_measurements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"position" "tire_position" NOT NULL,
	"brand" text,
	"dimension" text,
	"season" "tire_season",
	"tread_mm" numeric(4, 1),
	"damage" text,
	"dot" text,
	"rim_condition" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"platform_role" "platform_role" DEFAULT 'USER' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"locked_at" timestamp with time zone,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"text" text NOT NULL,
	"internal" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_damage_photos" (
	"damage_id" uuid NOT NULL,
	"photo_id" uuid NOT NULL,
	CONSTRAINT "vehicle_damage_photos_damage_id_photo_id_pk" PRIMARY KEY("damage_id","photo_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_damages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"zone" "damage_zone" NOT NULL,
	"kind" "damage_kind" NOT NULL,
	"size" text,
	"severity" "damage_severity" NOT NULL,
	"description" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "vehicle_document_kind" NOT NULL,
	"client_upload_id" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"visible_to_buyers" boolean DEFAULT false NOT NULL,
	"released_by" uuid,
	"released_at" timestamp with time zone,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"feature" "feature" NOT NULL,
	"result" "feature_result" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"slot" "photo_slot" NOT NULL,
	"client_upload_id" text NOT NULL,
	"storage_key_original" text NOT NULL,
	"storage_key_web" text,
	"storage_key_thumb" text,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"quality" "photo_quality" DEFAULT 'PENDING' NOT NULL,
	"quality_metrics" jsonb,
	"quality_override" boolean DEFAULT false NOT NULL,
	"upload_status" "upload_status" DEFAULT 'UPLOADED' NOT NULL,
	"replaced_by_id" uuid,
	"replaced_at" timestamp with time zone,
	"uploaded_by" uuid,
	"taken_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"changed_by" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"internal_number" text NOT NULL,
	"company_id" uuid NOT NULL,
	"inspection_request_id" uuid,
	"inspector_user_id" uuid,
	"vin" text,
	"vin_check" "vin_check" DEFAULT 'UNVERIFIED' NOT NULL,
	"license_plate" text,
	"make" text,
	"model" text,
	"variant" text,
	"first_registration" date,
	"model_year" integer,
	"mileage_km" integer,
	"fuel" "fuel_type",
	"power_kw" integer,
	"displacement_ccm" integer,
	"transmission" "transmission",
	"drive" "drive_type",
	"body" "body_type",
	"color" text,
	"doors" integer,
	"seats" integer,
	"owners_count" integer,
	"hu_until" text,
	"origin" text,
	"keys_count" integer,
	"equipment" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "vehicle_status" DEFAULT 'DRAFT' NOT NULL,
	"completeness_pct" integer DEFAULT 0 NOT NULL,
	"has_damages" boolean DEFAULT false NOT NULL,
	"paint_flagged" boolean DEFAULT false NOT NULL,
	"locked_at" timestamp with time zone,
	"inspection_started_at" timestamp with time zone,
	"inspection_completed_at" timestamp with time zone,
	"return_count" integer DEFAULT 0 NOT NULL,
	"review_note" text,
	"requested_photo_slots" text[] DEFAULT '{}'::text[] NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"location_street" text,
	"location_zip" text,
	"location_city" text,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"user_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watchlist_user_id_vehicle_id_pk" PRIMARY KEY("user_id","vehicle_id")
);
--> statement-breakpoint
ALTER TABLE "auction_bidders" ADD CONSTRAINT "auction_bidders_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auction_bidders" ADD CONSTRAINT "auction_bidders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_dealer_group_id_dealer_groups_id_fk" FOREIGN KEY ("dealer_group_id") REFERENCES "public"."dealer_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_current_bidder_company_id_companies_id_fk" FOREIGN KEY ("current_bidder_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battery_checks" ADD CONSTRAINT "battery_checks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_vehicles" ADD CONSTRAINT "catalog_vehicles_catalog_id_catalogs_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."catalogs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_vehicles" ADD CONSTRAINT "catalog_vehicles_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_dealer_group_id_dealer_groups_id_fk" FOREIGN KEY ("dealer_group_id") REFERENCES "public"."dealer_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalogs" ADD CONSTRAINT "catalogs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_users" ADD CONSTRAINT "company_users_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_status_history" ADD CONSTRAINT "deal_status_history_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_status_history" ADD CONSTRAINT "deal_status_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_group_members" ADD CONSTRAINT "dealer_group_members_group_id_dealer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."dealer_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_group_members" ADD CONSTRAINT "dealer_group_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_verifications" ADD CONSTRAINT "dealer_verifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_verifications" ADD CONSTRAINT "dealer_verifications_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_seller_company_id_companies_id_fk" FOREIGN KEY ("seller_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_company_id_companies_id_fk" FOREIGN KEY ("buyer_company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_winning_bid_id_bids_id_fk" FOREIGN KEY ("winning_bid_id") REFERENCES "public"."bids"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_codes" ADD CONSTRAINT "diagnostic_codes_report_id_diagnostic_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."diagnostic_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagnostic_reports" ADD CONSTRAINT "diagnostic_reports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_request_id_inspection_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."inspection_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_inspector_user_id_users_id_fk" FOREIGN KEY ("inspector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_assignments" ADD CONSTRAINT "inspection_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_requests" ADD CONSTRAINT "inspection_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_legal_document_id_legal_documents_id_fk" FOREIGN KEY ("legal_document_id") REFERENCES "public"."legal_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_documents" ADD CONSTRAINT "legal_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maximum_bids" ADD CONSTRAINT "maximum_bids_auction_id_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maximum_bids" ADD CONSTRAINT "maximum_bids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maximum_bids" ADD CONSTRAINT "maximum_bids_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paint_measurements" ADD CONSTRAINT "paint_measurements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_checks" ADD CONSTRAINT "pdr_checks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdr_checks" ADD CONSTRAINT "pdr_checks_lineboard_photo_id_vehicle_photos_id_fk" FOREIGN KEY ("lineboard_photo_id") REFERENCES "public"."vehicle_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_handed_over_by_users_id_fk" FOREIGN KEY ("handed_over_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_taken_over_by_users_id_fk" FOREIGN KEY ("taken_over_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_measurements" ADD CONSTRAINT "tire_measurements_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_comments" ADD CONSTRAINT "vehicle_comments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_comments" ADD CONSTRAINT "vehicle_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_damage_photos" ADD CONSTRAINT "vehicle_damage_photos_damage_id_vehicle_damages_id_fk" FOREIGN KEY ("damage_id") REFERENCES "public"."vehicle_damages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_damage_photos" ADD CONSTRAINT "vehicle_damage_photos_photo_id_vehicle_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."vehicle_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_damages" ADD CONSTRAINT "vehicle_damages_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_damages" ADD CONSTRAINT "vehicle_damages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_checks" ADD CONSTRAINT "vehicle_feature_checks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_photos" ADD CONSTRAINT "vehicle_photos_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_revisions" ADD CONSTRAINT "vehicle_revisions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_revisions" ADD CONSTRAINT "vehicle_revisions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_inspection_request_id_inspection_requests_id_fk" FOREIGN KEY ("inspection_request_id") REFERENCES "public"."inspection_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_inspector_user_id_users_id_fk" FOREIGN KEY ("inspector_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auction_bidders_label_uq" ON "auction_bidders" USING btree ("auction_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_number_uq" ON "auctions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "auctions_vehicle_open_uq" ON "auctions" USING btree ("vehicle_id") WHERE "auctions"."status" IN ('DRAFT','SCHEDULED','ACTIVE');--> statement-breakpoint
CREATE INDEX "auctions_status_starts_idx" ON "auctions" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "auctions_status_ends_idx" ON "auctions" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "auctions_catalog_idx" ON "auctions" USING btree ("catalog_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_event_idx" ON "audit_logs" USING btree ("event");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_sequence_uq" ON "bids" USING btree ("auction_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_transaction_uq" ON "bids" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bids_winning_uq" ON "bids" USING btree ("auction_id") WHERE "bids"."status" = 'WINNING';--> statement-breakpoint
CREATE INDEX "bids_company_idx" ON "bids" USING btree ("company_id","auction_id");--> statement-breakpoint
CREATE INDEX "bids_request_idx" ON "bids" USING btree ("auction_id","company_id","client_request_id");--> statement-breakpoint
CREATE INDEX "companies_type_status_idx" ON "companies" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "company_documents_company_idx" ON "company_documents" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_users_uq" ON "company_users" USING btree ("company_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_users_user_uq" ON "company_users" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "complaints_deal_idx" ON "complaints" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_status_history_deal_idx" ON "deal_status_history" USING btree ("deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_number_uq" ON "deals" USING btree ("deal_number");--> statement-breakpoint
CREATE UNIQUE INDEX "deals_auction_uq" ON "deals" USING btree ("auction_id");--> statement-breakpoint
CREATE INDEX "deals_buyer_idx" ON "deals" USING btree ("buyer_company_id");--> statement-breakpoint
CREATE INDEX "deals_seller_idx" ON "deals" USING btree ("seller_company_id");--> statement-breakpoint
CREATE INDEX "diagnostic_codes_report_idx" ON "diagnostic_codes" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "diagnostic_reports_vehicle_idx" ON "diagnostic_reports" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_documents_uq" ON "generated_documents" USING btree ("deal_id","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_assignments_active_uq" ON "inspection_assignments" USING btree ("request_id") WHERE "inspection_assignments"."active";--> statement-breakpoint
CREATE INDEX "inspection_assignments_inspector_idx" ON "inspection_assignments" USING btree ("inspector_user_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_requests_number_uq" ON "inspection_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "inspection_requests_company_idx" ON "inspection_requests" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "inspection_requests_status_idx" ON "inspection_requests" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_uq" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_deal_kind_uq" ON "invoices" USING btree ("deal_id","kind");--> statement-breakpoint
CREATE INDEX "jobs_pending_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_uq" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" IS NOT NULL AND "jobs"."status" IN ('PENDING','RUNNING');--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acceptances_uq" ON "legal_acceptances" USING btree ("user_id","legal_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_version_uq" ON "legal_documents" USING btree ("kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "maximum_bids_uq" ON "maximum_bids" USING btree ("auction_id","company_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paint_measurements_uq" ON "paint_measurements" USING btree ("vehicle_id","point");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscriptions_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tire_measurements_uq" ON "tire_measurements" USING btree ("vehicle_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "vehicle_comments_vehicle_idx" ON "vehicle_comments" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_damages_vehicle_idx" ON "vehicle_damages" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_documents_client_upload_uq" ON "vehicle_documents" USING btree ("vehicle_id","client_upload_id");--> statement-breakpoint
CREATE INDEX "vehicle_documents_vehicle_idx" ON "vehicle_documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_feature_checks_uq" ON "vehicle_feature_checks" USING btree ("vehicle_id","feature");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_photos_client_upload_uq" ON "vehicle_photos" USING btree ("vehicle_id","client_upload_id");--> statement-breakpoint
CREATE INDEX "vehicle_photos_vehicle_idx" ON "vehicle_photos" USING btree ("vehicle_id","slot");--> statement-breakpoint
CREATE INDEX "vehicle_revisions_vehicle_idx" ON "vehicle_revisions" USING btree ("vehicle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_internal_number_uq" ON "vehicles" USING btree ("internal_number");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_uq" ON "vehicles" USING btree ("vin") WHERE "vehicles"."vin" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "vehicles_company_idx" ON "vehicles" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "vehicles_status_idx" ON "vehicles" USING btree ("status");--> statement-breakpoint
CREATE INDEX "vehicles_request_idx" ON "vehicles" USING btree ("inspection_request_id");