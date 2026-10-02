# 02 – Datenmodell (PostgreSQL)

Alle Tabellen haben `id uuid pk default gen_random_uuid()`, `created_at timestamptz`, `updated_at timestamptz` (sofern nicht anders angegeben). Beträge in **Cent (bigint)**. Enums als Postgres-Enums (Quelle: `packages/shared/src/enums.ts`).

## Identität & Mandanten

| Tabelle | Wichtige Spalten | Hinweise |
|---|---|---|
| `users` | email (unique, lowercase), password_hash, first_name, last_name, phone, platform_role (`SUPERADMIN`,`ADMIN`,`INSPECTOR`,`USER`), is_active, locked_at, last_login_at | Außendienst = `INSPECTOR` |
| `sessions` | user_id, token_hash, expires_at, ip, user_agent, revoked_at | Session-Invalidierung |
| `companies` | type (`DEALERSHIP`,`DEALER`), name, legal_form, street, house_number, zip, city, country, website, register_number, vat_id, status (`REGISTRATION_STARTED`,`DOCUMENTS_MISSING`,`IN_REVIEW`,`APPROVED`,`REJECTED`,`BLOCKED`), brands text[], trade_type, bank_iban, contact_first_name, contact_last_name, contact_phone, contact_email, review_note, reviewed_by, reviewed_at | Mandant |
| `company_users` | company_id, user_id, company_role (`OWNER`,`MANAGER`,`MEMBER`), job_title | unique(company_id,user_id) |
| `company_documents` | company_id, kind (`TRADE_LICENSE`,`ID_DOCUMENT`,`REGISTER_EXTRACT`,`OTHER`), storage_key, mime, size, uploaded_by | Gewerbenachweis etc. |
| `dealer_verifications` | company_id (unique), bidding_status (`VIEW_ONLY`,`CAN_BID`,`TEMP_BLOCKED`,`BLOCKED`), blocked_until, reviewed_by, reviewed_at, note | nur für `DEALER` |
| `dealer_groups` | name, description | Händlergruppen |
| `dealer_group_members` | group_id, company_id | unique |
| `legal_documents` | kind (`TERMS`,`BIDDER_TERMS`,`PRIVACY`), version, title, content, active_from, created_by | versioniert; aktive Version unveränderlich |
| `legal_acceptances` | user_id, company_id, legal_document_id, accepted_at, ip, user_agent | unique(user_id, legal_document_id) |

## Aufnahme / Disposition

| Tabelle | Spalten |
|---|---|
| `inspection_requests` | company_id, created_by, vehicle_count, location_street, location_zip, location_city, requested_date, earliest_time, latest_time, contact_name, contact_phone, notes, vehicles_drivable, keys_available, papers_available, status (`NEW`,`PLANNED`,`ASSIGNED`,`EN_ROUTE`,`ON_SITE`,`IN_PROGRESS`,`COMPLETED`,`CANCELLED`), scheduled_at, cancelled_reason |
| `inspection_assignments` | request_id, inspector_user_id, assigned_by, scheduled_at, started_at, arrived_at, completed_at, note, active (partial unique: eine aktive Zuweisung je Anfrage) |

## Fahrzeugakte

| Tabelle | Spalten |
|---|---|
| `vehicles` | internal_number (unique, `FZ-000123`), company_id (Einlieferer), inspection_request_id, inspector_user_id, vin, vin_check (`VALID`,`INVALID`,`UNVERIFIED`), license_plate, make, model, variant, first_registration, mileage_km, fuel, power_kw, displacement_ccm, transmission, drive, body, color, doors, seats, owners_count, hu_until, origin, keys_count, status (Vehicle-Enum), completeness_pct, locked_at, review_note, approved_by, approved_at, location_street/zip/city |
| `vehicle_photos` | vehicle_id, slot (28 Pflicht-Slots + `EXTRA`,`DAMAGE`,`DOCUMENT`,`PDR_LINEBOARD`), storage_key_original, storage_key_web, storage_key_thumb, width, height, size_bytes, sha256, quality (`PENDING`,`OK`,`BLURRY`,`DARK`,`BRIGHT`,`REJECTED`), quality_metrics jsonb, upload_status (`PENDING`,`UPLOADED`,`PROCESSED`,`FAILED`), client_upload_id (unique → Doppel-Upload erkannt), taken_at |
| `vehicle_documents` | vehicle_id, kind (`REGISTRATION_1`,`REGISTRATION_2`,`SERVICE_BOOK`,`HU_REPORT`,`APPRAISAL`,`OTHER`), storage_key, mime, size_bytes, visible_to_buyers, released_by, released_at |
| `vehicle_damages` | vehicle_id, zone (Karosserie-Zonen-Enum), kind (Schadenart-Enum), size, severity (`LOW`,`MEDIUM`,`HIGH`), description |
| `vehicle_damage_photos` | damage_id, photo_id |
| `paint_measurements` | vehicle_id, point (11 Messpunkte), value_um, flagged; unique(vehicle_id, point) |
| `tire_measurements` | vehicle_id, position (`FL`,`FR`,`RL`,`RR`), brand, dimension, season (`SUMMER`,`WINTER`,`ALL_SEASON`), tread_mm, damage, dot, rim_condition; unique(vehicle_id, position) |
| `pdr_checks` | vehicle_id (unique), performed, lineboard_photo_id, dent_count, positions, size, paint_damaged |
| `diagnostic_reports` | vehicle_id, device, performed_at, ecus jsonb, notes |
| `diagnostic_codes` | report_id, code, description, status (`PERMANENT`,`PENDING`,`CURRENT`,`UNKNOWN`) — Trigger verbietet DELETE |
| `battery_checks` | vehicle_id (unique), kind (`ICE`,`EV`,`HYBRID`), voltage, test_result, cold_cranking, hv_info jsonb, hv_source |
| `vehicle_feature_checks` | vehicle_id, feature (Enum), result (`OK`,`DEFECT`,`NOT_CHECKED`,`NOT_PRESENT`), note; unique(vehicle_id, feature) |
| `vehicle_revisions` | vehicle_id, changed_by, field, old_value, new_value, reason | Korrekturen nach Sperrung; Originalwerte bleiben erhalten |
| `vehicle_comments` | vehicle_id, user_id, text, internal |

## Katalog / Auktion

| Tabelle | Spalten |
|---|---|
| `catalogs` | name, description, starts_at, ends_at, dealer_group_id, status (`DRAFT`,`PUBLISHED`,`CLOSED`) |
| `catalog_vehicles` | catalog_id, vehicle_id, sort; unique(catalog_id, vehicle_id) |
| `auctions` | vehicle_id, catalog_id, status (`DRAFT`,`SCHEDULED`,`ACTIVE`,`ENDED`,`CANCELLED`), starts_at, ends_at, original_ends_at, duration_minutes, start_price, reserve_price, reserve_visible, bid_increment, buy_now_price, dealer_group_id, buyer_fee_pct, buyer_fee_fixed, seller_fee_pct, seller_fee_fixed, tax_type (`REGELBESTEUERT`,`DIFFERENZBESTEUERT`), location_*, earliest_pickup, anti_snipe_minutes (0/1/2/3/5), current_bid, current_bidder_company_id, bid_count, extension_count, outcome (`SOLD`,`RESERVE_NOT_MET`,`NO_BIDS`,`CANCELLED`,`BUY_NOW`), ended_at, version |
| `bids` | auction_id, company_id, user_id, amount, server_time, ip, user_agent, transaction_id (unique), client_request_id, kind (`MANUAL`,`PROXY`,`BUY_NOW`), status (`ACCEPTED`,`OUTBID`,`WINNING`), sequence (unique(auction_id, sequence)) — Trigger verbietet UPDATE außer `status`, verbietet DELETE |
| `maximum_bids` | auction_id, company_id, user_id, max_amount, active; unique(auction_id, company_id) | nie für andere sichtbar |
| `watchlist` | company_id, user_id, vehicle_id; unique(user_id, vehicle_id) |

**Entscheidung:** Eine Auktion = ein Fahrzeug (Zeitauktion, Spec §21/§23 „pro Fahrzeug“). Die im Objektkatalog genannte Entität `AuctionVehicle` ist in `auctions` aufgegangen; `catalogs`/`catalog_vehicles` übernehmen die Gruppierung. Partial-Unique-Index: ein Fahrzeug darf nur in **einer** nicht-beendeten Auktion stehen.

## Verkauf

| Tabelle | Spalten |
|---|---|
| `deals` | deal_number (unique, `D-2026-000123`), auction_id (unique), vehicle_id, seller_company_id, buyer_company_id, winning_bid_id, sale_price, buyer_fee, seller_fee, vat_rate_bp, vat_amount, buyer_total, seller_payout, tax_type, vin_snapshot, vehicle_snapshot jsonb, sold_at, auction_ended_at, status (Deal-Enum), payment_due_at, paid_at, cancelled_reason | Kernfelder via Trigger unveränderlich |
| `deal_status_history` | deal_id, from_status, to_status, changed_by, note |
| `invoices` | deal_id, kind (`BUYER_FEE`,`SELLER_FEE`), number (unique), net, vat, gross, issued_at |
| `generated_documents` | deal_id, kind (`BUYER`,`SELLER`,`INTERNAL`), version, storage_key, sha256, generated_at, generated_by, reason; unique(deal_id, kind, version) |
| `pickups` | deal_id (unique), location_*, contact_name, contact_phone, opening_hours, pickup_code, scheduled_at, handed_over_at, handed_over_by, taken_over_at, taken_over_by |
| `complaints` | deal_id, opened_by, reason, description, status (`OPEN`,`IN_REVIEW`,`RESOLVED`,`REJECTED`), resolution, resolved_by, resolved_at |

## System

| Tabelle | Spalten |
|---|---|
| `notifications` | user_id, type (Ereignis-Enum), title, body, data jsonb, read_at, email_sent_at |
| `push_subscriptions` | user_id, endpoint (unique), keys jsonb |
| `audit_logs` | actor_user_id, actor_role, actor_company_id, event (Enum), entity_type, entity_id, old_value jsonb, new_value jsonb, ip, user_agent, created_at | append-only (Trigger verbietet UPDATE/DELETE) |
| `platform_settings` | key (pk), value jsonb, updated_by | Gebühren-Defaults, Anti-Sniping-Default, Zahlungsfrist |

## Integritätsregeln auf DB-Ebene

* `audit_logs`, `diagnostic_codes`, `generated_documents`: Trigger blockieren `UPDATE`/`DELETE`.
* `bids`: `DELETE` verboten; `UPDATE` nur auf `status`.
* `deals`: Trigger blockiert Änderung von `sale_price`, `buyer_company_id`, `seller_company_id`, `vehicle_id`, `vin_snapshot`, `winning_bid_id`, `sold_at`.
* `vehicles.vin`: partial unique index `WHERE vin IS NOT NULL`; VIN-Prüfziffer (ISO 3779) wird im Service geprüft und als `vin_check` gespeichert.
* `auctions`: partial unique index auf `vehicle_id WHERE status IN ('DRAFT','SCHEDULED','ACTIVE')`.
* Gebotslogik: `SELECT … FROM auctions WHERE id=$1 FOR UPDATE` + `now()`-Vergleich in derselben Transaktion (siehe `docs/04-zustandsmaschinen.md`).
