-- Nummernkreise
CREATE SEQUENCE IF NOT EXISTS vehicle_number_seq START 1001;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS deal_number_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS auction_number_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS inspection_number_seq START 1;
--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
--> statement-breakpoint

-- Append-only-Tabellen: UPDATE und DELETE sind verboten (auch für die Anwendung selbst).
CREATE OR REPLACE FUNCTION sd_forbid_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabelle % ist unveränderlich (append-only): % nicht erlaubt', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER diagnostic_codes_immutable BEFORE UPDATE OR DELETE ON diagnostic_codes
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER diagnostic_reports_immutable BEFORE UPDATE OR DELETE ON diagnostic_reports
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER generated_documents_immutable BEFORE UPDATE OR DELETE ON generated_documents
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER deal_status_history_immutable BEFORE UPDATE OR DELETE ON deal_status_history
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER vehicle_revisions_immutable BEFORE UPDATE OR DELETE ON vehicle_revisions
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint
CREATE TRIGGER legal_acceptances_immutable BEFORE UPDATE OR DELETE ON legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION sd_forbid_modification();
--> statement-breakpoint

-- Gebote: nie löschen; nur der Status (WINNING → OUTBID) darf sich ändern.
CREATE OR REPLACE FUNCTION sd_bids_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Gebote dürfen nicht gelöscht werden' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.company_id <> OLD.company_id OR NEW.user_id <> OLD.user_id
     OR NEW.auction_id <> OLD.auction_id OR NEW.server_time <> OLD.server_time OR NEW.sequence <> OLD.sequence
     OR NEW.transaction_id <> OLD.transaction_id OR NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'Gebotsdaten sind unveränderlich' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD.status = 'OUTBID' AND NEW.status = 'WINNING' THEN
    RAISE EXCEPTION 'Ein überbotenes Gebot kann nicht wieder führend werden' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER bids_guard BEFORE UPDATE OR DELETE ON bids
  FOR EACH ROW EXECUTE FUNCTION sd_bids_guard();
--> statement-breakpoint

-- Deals: Kernfelder des Zuschlags sind unveränderlich; Löschen verboten.
CREATE OR REPLACE FUNCTION sd_deals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Deals dürfen nicht gelöscht werden' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.deal_number <> OLD.deal_number OR NEW.auction_id <> OLD.auction_id OR NEW.vehicle_id <> OLD.vehicle_id
     OR NEW.seller_company_id <> OLD.seller_company_id OR NEW.buyer_company_id <> OLD.buyer_company_id
     OR NEW.winning_bid_id <> OLD.winning_bid_id OR NEW.sale_price <> OLD.sale_price
     OR NEW.vehicle_vat <> OLD.vehicle_vat OR NEW.buyer_fee_net <> OLD.buyer_fee_net
     OR NEW.seller_fee_net <> OLD.seller_fee_net OR NEW.buyer_total <> OLD.buyer_total
     OR NEW.seller_payout <> OLD.seller_payout OR NEW.vin_snapshot IS DISTINCT FROM OLD.vin_snapshot
     OR NEW.vehicle_snapshot <> OLD.vehicle_snapshot OR NEW.sold_at <> OLD.sold_at
     OR NEW.auction_ended_at <> OLD.auction_ended_at OR NEW.tax_type <> OLD.tax_type THEN
    RAISE EXCEPTION 'Zuschlagsdaten eines Deals sind unveränderlich' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER deals_guard BEFORE UPDATE OR DELETE ON deals
  FOR EACH ROW EXECUTE FUNCTION sd_deals_guard();
--> statement-breakpoint

-- Fahrzeugakten dürfen nie gelöscht werden (Spec §8).
CREATE OR REPLACE FUNCTION sd_forbid_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Löschen in % ist nicht erlaubt', TG_TABLE_NAME USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER vehicles_no_delete BEFORE DELETE ON vehicles FOR EACH ROW EXECUTE FUNCTION sd_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER vehicle_photos_no_delete BEFORE DELETE ON vehicle_photos FOR EACH ROW EXECUTE FUNCTION sd_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER vehicle_documents_no_delete BEFORE DELETE ON vehicle_documents FOR EACH ROW EXECUTE FUNCTION sd_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER auctions_no_delete BEFORE DELETE ON auctions FOR EACH ROW EXECUTE FUNCTION sd_forbid_delete();
--> statement-breakpoint
CREATE TRIGGER legal_documents_no_delete BEFORE DELETE ON legal_documents FOR EACH ROW EXECUTE FUNCTION sd_forbid_delete();
--> statement-breakpoint

-- Plausibilitäts-Constraints
ALTER TABLE auctions ADD CONSTRAINT auctions_time_ck CHECK (ends_at > starts_at);
--> statement-breakpoint
ALTER TABLE auctions ADD CONSTRAINT auctions_prices_ck CHECK (start_price > 0 AND bid_increment > 0 AND (reserve_price IS NULL OR reserve_price >= 0) AND (buy_now_price IS NULL OR buy_now_price > start_price));
--> statement-breakpoint
ALTER TABLE auctions ADD CONSTRAINT auctions_anti_snipe_ck CHECK (anti_snipe_minutes IN (0,1,2,3,5));
--> statement-breakpoint
ALTER TABLE bids ADD CONSTRAINT bids_amount_ck CHECK (amount > 0);
--> statement-breakpoint
ALTER TABLE maximum_bids ADD CONSTRAINT maximum_bids_amount_ck CHECK (max_amount > 0);
--> statement-breakpoint
ALTER TABLE paint_measurements ADD CONSTRAINT paint_value_ck CHECK (value_um >= 0);
