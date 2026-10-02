import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  AUCTION_OUTCOMES,
  AUCTION_STATUSES,
  BATTERY_KINDS,
  BID_KINDS,
  BID_STATUSES,
  BIDDING_STATUSES,
  BODY_TYPES,
  CATALOG_STATUSES,
  COMPANY_DOCUMENT_KINDS,
  COMPANY_ROLES,
  COMPANY_STATUSES,
  COMPANY_TYPES,
  COMPLAINT_STATUSES,
  DAMAGE_KINDS,
  DAMAGE_SEVERITIES,
  DAMAGE_ZONES,
  DEAL_STATUSES,
  DRIVE_TYPES,
  DTC_STATUSES,
  EMISSION_CLASSES,
  FEATURE_RESULTS,
  FEATURES,
  FUEL_TYPES,
  GENERATED_DOCUMENT_KINDS,
  HOLDER_TYPES,
  INSPECTION_STATUSES,
  INVOICE_KINDS,
  JOB_STATUSES,
  LEGAL_KINDS,
  NOTIFICATION_TYPES,
  PAINT_POINTS,
  PHOTO_QUALITIES,
  PHOTO_SLOTS,
  PLATFORM_ROLES,
  TAX_TYPES,
  TIRE_POSITIONS,
  TIRE_SEASONS,
  TRANSMISSIONS,
  UPLOAD_STATUSES,
  VEHICLE_DOCUMENT_KINDS,
  VEHICLE_STATUSES,
  VIN_CHECKS,
} from '@sd/shared';

// ---------- Enums ----------
export const platformRoleEnum = pgEnum('platform_role', PLATFORM_ROLES);
export const companyTypeEnum = pgEnum('company_type', COMPANY_TYPES);
export const companyRoleEnum = pgEnum('company_role', COMPANY_ROLES);
export const companyStatusEnum = pgEnum('company_status', COMPANY_STATUSES);
export const biddingStatusEnum = pgEnum('bidding_status', BIDDING_STATUSES);
export const companyDocumentKindEnum = pgEnum('company_document_kind', COMPANY_DOCUMENT_KINDS);
export const legalKindEnum = pgEnum('legal_kind', LEGAL_KINDS);
export const inspectionStatusEnum = pgEnum('inspection_status', INSPECTION_STATUSES);
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES);
export const vinCheckEnum = pgEnum('vin_check', VIN_CHECKS);
export const fuelEnum = pgEnum('fuel_type', FUEL_TYPES);
export const transmissionEnum = pgEnum('transmission', TRANSMISSIONS);
export const driveEnum = pgEnum('drive_type', DRIVE_TYPES);
export const bodyEnum = pgEnum('body_type', BODY_TYPES);
export const emissionClassEnum = pgEnum('emission_class', EMISSION_CLASSES);
export const holderTypeEnum = pgEnum('holder_type', HOLDER_TYPES);
export const photoSlotEnum = pgEnum('photo_slot', PHOTO_SLOTS);
export const photoQualityEnum = pgEnum('photo_quality', PHOTO_QUALITIES);
export const uploadStatusEnum = pgEnum('upload_status', UPLOAD_STATUSES);
export const vehicleDocumentKindEnum = pgEnum('vehicle_document_kind', VEHICLE_DOCUMENT_KINDS);
export const damageZoneEnum = pgEnum('damage_zone', DAMAGE_ZONES);
export const damageKindEnum = pgEnum('damage_kind', DAMAGE_KINDS);
export const damageSeverityEnum = pgEnum('damage_severity', DAMAGE_SEVERITIES);
export const paintPointEnum = pgEnum('paint_point', PAINT_POINTS);
export const tirePositionEnum = pgEnum('tire_position', TIRE_POSITIONS);
export const tireSeasonEnum = pgEnum('tire_season', TIRE_SEASONS);
export const dtcStatusEnum = pgEnum('dtc_status', DTC_STATUSES);
export const batteryKindEnum = pgEnum('battery_kind', BATTERY_KINDS);
export const featureEnum = pgEnum('feature', FEATURES);
export const featureResultEnum = pgEnum('feature_result', FEATURE_RESULTS);
export const catalogStatusEnum = pgEnum('catalog_status', CATALOG_STATUSES);
export const auctionStatusEnum = pgEnum('auction_status', AUCTION_STATUSES);
export const auctionOutcomeEnum = pgEnum('auction_outcome', AUCTION_OUTCOMES);
export const taxTypeEnum = pgEnum('tax_type', TAX_TYPES);
export const bidKindEnum = pgEnum('bid_kind', BID_KINDS);
export const bidStatusEnum = pgEnum('bid_status', BID_STATUSES);
export const dealStatusEnum = pgEnum('deal_status', DEAL_STATUSES);
export const generatedDocumentKindEnum = pgEnum('generated_document_kind', GENERATED_DOCUMENT_KINDS);
export const invoiceKindEnum = pgEnum('invoice_kind', INVOICE_KINDS);
export const complaintStatusEnum = pgEnum('complaint_status', COMPLAINT_STATUSES);
export const notificationTypeEnum = pgEnum('notification_type', NOTIFICATION_TYPES);
export const jobStatusEnum = pgEnum('job_status', JOB_STATUSES);

// ---------- Helpers ----------
const id = () => uuid('id').primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();
const updatedAt = () => ts('updated_at').notNull().defaultNow();
const money = (name: string) => bigint(name, { mode: 'number' });

// ---------- Identität & Mandanten ----------
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phone: text('phone'),
    platformRole: platformRoleEnum('platform_role').notNull().default('USER'),
    isActive: boolean('is_active').notNull().default(true),
    lockedAt: ts('locked_at'),
    failedLogins: integer('failed_logins').notNull().default(0),
    lastLoginAt: ts('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: ts('revoked_at'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('sessions_token_uq').on(t.tokenHash), index('sessions_user_idx').on(t.userId)],
);

export const companies = pgTable(
  'companies',
  {
    id: id(),
    type: companyTypeEnum('type').notNull(),
    name: text('name').notNull(),
    legalForm: text('legal_form').notNull(),
    street: text('street').notNull(),
    houseNumber: text('house_number').notNull(),
    zip: text('zip').notNull(),
    city: text('city').notNull(),
    country: text('country').notNull().default('DE'),
    website: text('website'),
    registerNumber: text('register_number'),
    vatId: text('vat_id'),
    brands: text('brands').array().notNull().default(sql`'{}'::text[]`),
    tradeType: text('trade_type'),
    bankIban: text('bank_iban'),
    contactFirstName: text('contact_first_name').notNull(),
    contactLastName: text('contact_last_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    contactEmail: text('contact_email').notNull(),
    status: companyStatusEnum('status').notNull().default('REGISTRATION_STARTED'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: ts('reviewed_at'),
    lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
    lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('companies_type_status_idx').on(t.type, t.status)],
);

export const companyUsers = pgTable(
  'company_users',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    companyRole: companyRoleEnum('company_role').notNull().default('MEMBER'),
    jobTitle: text('job_title'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('company_users_uq').on(t.companyId, t.userId), uniqueIndex('company_users_user_uq').on(t.userId)],
);

export const companyDocuments = pgTable(
  'company_documents',
  {
    id: id(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    kind: companyDocumentKindEnum('kind').notNull(),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('company_documents_company_idx').on(t.companyId)],
);

export const dealerVerifications = pgTable('dealer_verifications', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id),
  biddingStatus: biddingStatusEnum('bidding_status').notNull().default('VIEW_ONLY'),
  blockedUntil: ts('blocked_until'),
  note: text('note'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: ts('reviewed_at'),
  updatedAt: updatedAt(),
});

export const dealerGroups = pgTable('dealer_groups', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const dealerGroupMembers = pgTable(
  'dealer_group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => dealerGroups.id, { onDelete: 'cascade' }),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.companyId] })],
);

export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: id(),
    kind: legalKindEnum('kind').notNull(),
    version: text('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    activeFrom: ts('active_from').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('legal_documents_kind_version_uq').on(t.kind, t.version)],
);

export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    companyId: uuid('company_id').references(() => companies.id),
    legalDocumentId: uuid('legal_document_id')
      .notNull()
      .references(() => legalDocuments.id),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [uniqueIndex('legal_acceptances_uq').on(t.userId, t.legalDocumentId)],
);

// ---------- Aufnahme / Disposition ----------
export const inspectionRequests = pgTable(
  'inspection_requests',
  {
    id: id(),
    number: text('number').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    vehicleCount: integer('vehicle_count').notNull(),
    locationStreet: text('location_street').notNull(),
    locationZip: text('location_zip').notNull(),
    locationCity: text('location_city').notNull(),
    requestedDate: date('requested_date', { mode: 'string' }).notNull(),
    earliestTime: text('earliest_time').notNull(),
    latestTime: text('latest_time').notNull(),
    contactName: text('contact_name').notNull(),
    contactPhone: text('contact_phone').notNull(),
    notes: text('notes'),
    vehiclesDrivable: boolean('vehicles_drivable').notNull(),
    keysAvailable: boolean('keys_available').notNull(),
    papersAvailable: boolean('papers_available').notNull(),
    status: inspectionStatusEnum('status').notNull().default('NEW'),
    scheduledAt: ts('scheduled_at'),
    cancelledReason: text('cancelled_reason'),
    lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
    lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('inspection_requests_number_uq').on(t.number),
    index('inspection_requests_company_idx').on(t.companyId),
    index('inspection_requests_status_idx').on(t.status, t.scheduledAt),
  ],
);

export const inspectionAssignments = pgTable(
  'inspection_assignments',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => inspectionRequests.id),
    inspectorUserId: uuid('inspector_user_id')
      .notNull()
      .references(() => users.id),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id),
    scheduledAt: ts('scheduled_at').notNull(),
    active: boolean('active').notNull().default(true),
    enRouteAt: ts('en_route_at'),
    arrivedAt: ts('arrived_at'),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('inspection_assignments_active_uq').on(t.requestId).where(sql`${t.active}`),
    index('inspection_assignments_inspector_idx').on(t.inspectorUserId, t.scheduledAt),
  ],
);

// ---------- Fahrzeugakte ----------
export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    internalNumber: text('internal_number').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    inspectionRequestId: uuid('inspection_request_id').references(() => inspectionRequests.id),
    inspectorUserId: uuid('inspector_user_id').references(() => users.id),
    vin: text('vin'),
    vinCheck: vinCheckEnum('vin_check').notNull().default('UNVERIFIED'),
    licensePlate: text('license_plate'),
    make: text('make'),
    model: text('model'),
    variant: text('variant'),
    firstRegistration: date('first_registration', { mode: 'string' }),
    modelYear: integer('model_year'),
    mileageKm: integer('mileage_km'),
    fuel: fuelEnum('fuel'),
    powerKw: integer('power_kw'),
    displacementCcm: integer('displacement_ccm'),
    transmission: transmissionEnum('transmission'),
    drive: driveEnum('drive'),
    body: bodyEnum('body'),
    color: text('color'),
    doors: integer('doors'),
    seats: integer('seats'),
    ownersCount: integer('owners_count'),
    huUntil: text('hu_until'),
    origin: text('origin'),
    emissionClass: emissionClassEnum('emission_class'),
    holderType: holderTypeEnum('holder_type'),
    keysCount: integer('keys_count'),
    equipment: text('equipment').array().notNull().default(sql`'{}'::text[]`),
    status: vehicleStatusEnum('status').notNull().default('DRAFT'),
    completenessPct: integer('completeness_pct').notNull().default(0),
    hasDamages: boolean('has_damages').notNull().default(false),
    paintFlagged: boolean('paint_flagged').notNull().default(false),
    lockedAt: ts('locked_at'),
    inspectionStartedAt: ts('inspection_started_at'),
    inspectionCompletedAt: ts('inspection_completed_at'),
    returnCount: integer('return_count').notNull().default(0),
    reviewNote: text('review_note'),
    requestedPhotoSlots: text('requested_photo_slots').array().notNull().default(sql`'{}'::text[]`),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: ts('approved_at'),
    locationStreet: text('location_street'),
    locationZip: text('location_zip'),
    locationCity: text('location_city'),
    lat: numeric('lat', { precision: 9, scale: 6, mode: 'number' }),
    lng: numeric('lng', { precision: 9, scale: 6, mode: 'number' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('vehicles_internal_number_uq').on(t.internalNumber),
    // FIN eindeutig unter allen nicht abgeschlossenen Akten (Wiederaufnahme nach Verkauf bleibt möglich).
    uniqueIndex('vehicles_vin_active_uq').on(t.vin).where(sql`${t.vin} IS NOT NULL AND ${t.status} <> 'COMPLETED'`),
    index('vehicles_vin_idx').on(t.vin),
    index('vehicles_company_idx').on(t.companyId, t.status),
    index('vehicles_status_idx').on(t.status),
    index('vehicles_request_idx').on(t.inspectionRequestId),
  ],
);

export const vehiclePhotos = pgTable(
  'vehicle_photos',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    slot: photoSlotEnum('slot').notNull(),
    clientUploadId: text('client_upload_id').notNull(),
    storageKeyOriginal: text('storage_key_original').notNull(),
    storageKeyWeb: text('storage_key_web'),
    storageKeyThumb: text('storage_key_thumb'),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    quality: photoQualityEnum('quality').notNull().default('PENDING'),
    qualityMetrics: jsonb('quality_metrics'),
    qualityOverride: boolean('quality_override').notNull().default(false),
    uploadStatus: uploadStatusEnum('upload_status').notNull().default('UPLOADED'),
    /** Ersetzte Fotos bleiben erhalten (keine unbemerkte Manipulation), werden aber nicht mehr gezählt. */
    replacedById: uuid('replaced_by_id'),
    replacedAt: ts('replaced_at'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    takenAt: ts('taken_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('vehicle_photos_client_upload_uq').on(t.vehicleId, t.clientUploadId),
    index('vehicle_photos_vehicle_idx').on(t.vehicleId, t.slot),
  ],
);

export const vehicleDocuments = pgTable(
  'vehicle_documents',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    kind: vehicleDocumentKindEnum('kind').notNull(),
    clientUploadId: text('client_upload_id').notNull(),
    fileName: text('file_name').notNull(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    visibleToBuyers: boolean('visible_to_buyers').notNull().default(false),
    releasedBy: uuid('released_by').references(() => users.id),
    releasedAt: ts('released_at'),
    uploadedBy: uuid('uploaded_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('vehicle_documents_client_upload_uq').on(t.vehicleId, t.clientUploadId),
    index('vehicle_documents_vehicle_idx').on(t.vehicleId),
  ],
);

export const vehicleDamages = pgTable(
  'vehicle_damages',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    zone: damageZoneEnum('zone').notNull(),
    kind: damageKindEnum('kind').notNull(),
    size: text('size'),
    severity: damageSeverityEnum('severity').notNull(),
    description: text('description'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('vehicle_damages_vehicle_idx').on(t.vehicleId)],
);

export const vehicleDamagePhotos = pgTable(
  'vehicle_damage_photos',
  {
    damageId: uuid('damage_id')
      .notNull()
      .references(() => vehicleDamages.id, { onDelete: 'cascade' }),
    photoId: uuid('photo_id')
      .notNull()
      .references(() => vehiclePhotos.id),
  },
  (t) => [primaryKey({ columns: [t.damageId, t.photoId] })],
);

export const paintMeasurements = pgTable(
  'paint_measurements',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    point: paintPointEnum('point').notNull(),
    valueUm: integer('value_um').notNull(),
    flagged: boolean('flagged').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('paint_measurements_uq').on(t.vehicleId, t.point)],
);

export const tireMeasurements = pgTable(
  'tire_measurements',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    position: tirePositionEnum('position').notNull(),
    brand: text('brand'),
    dimension: text('dimension'),
    season: tireSeasonEnum('season'),
    treadMm: numeric('tread_mm', { precision: 4, scale: 1, mode: 'number' }),
    damage: text('damage'),
    dot: text('dot'),
    rimCondition: text('rim_condition'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('tire_measurements_uq').on(t.vehicleId, t.position)],
);

export const pdrChecks = pgTable('pdr_checks', {
  vehicleId: uuid('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id),
  performed: boolean('performed').notNull(),
  lineboardPhotoId: uuid('lineboard_photo_id').references(() => vehiclePhotos.id),
  dentCount: integer('dent_count'),
  positions: text('positions'),
  size: text('size'),
  paintDamaged: boolean('paint_damaged'),
  updatedAt: updatedAt(),
});

export const diagnosticReports = pgTable(
  'diagnostic_reports',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    device: text('device').notNull(),
    performedAt: ts('performed_at').notNull(),
    ecus: jsonb('ecus').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('diagnostic_reports_vehicle_idx').on(t.vehicleId)],
);

export const diagnosticCodes = pgTable(
  'diagnostic_codes',
  {
    id: id(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => diagnosticReports.id),
    code: text('code').notNull(),
    description: text('description'),
    status: dtcStatusEnum('status').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('diagnostic_codes_report_idx').on(t.reportId)],
);

export const batteryChecks = pgTable('battery_checks', {
  vehicleId: uuid('vehicle_id')
    .primaryKey()
    .references(() => vehicles.id),
  kind: batteryKindEnum('kind').notNull(),
  voltage: numeric('voltage', { precision: 6, scale: 2, mode: 'number' }),
  testResult: text('test_result'),
  coldCranking: integer('cold_cranking'),
  hvInfo: jsonb('hv_info'),
  hvSource: text('hv_source'),
  updatedAt: updatedAt(),
});

export const vehicleFeatureChecks = pgTable(
  'vehicle_feature_checks',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    feature: featureEnum('feature').notNull(),
    result: featureResultEnum('result').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('vehicle_feature_checks_uq').on(t.vehicleId, t.feature)],
);

export const vehicleRevisions = pgTable(
  'vehicle_revisions',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    changedBy: uuid('changed_by')
      .notNull()
      .references(() => users.id),
    field: text('field').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('vehicle_revisions_vehicle_idx').on(t.vehicleId)],
);

export const vehicleComments = pgTable(
  'vehicle_comments',
  {
    id: id(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    text: text('text').notNull(),
    internal: boolean('internal').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('vehicle_comments_vehicle_idx').on(t.vehicleId)],
);

// ---------- Kataloge / Auktionen ----------
export const catalogs = pgTable('catalogs', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  dealerGroupId: uuid('dealer_group_id').references(() => dealerGroups.id),
  status: catalogStatusEnum('status').notNull().default('DRAFT'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const catalogVehicles = pgTable(
  'catalog_vehicles',
  {
    catalogId: uuid('catalog_id')
      .notNull()
      .references(() => catalogs.id, { onDelete: 'cascade' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.catalogId, t.vehicleId] })],
);

export const auctions = pgTable(
  'auctions',
  {
    id: id(),
    number: text('number').notNull(),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    catalogId: uuid('catalog_id').references(() => catalogs.id),
    status: auctionStatusEnum('status').notNull().default('DRAFT'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    originalEndsAt: ts('original_ends_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    startPrice: money('start_price').notNull(),
    reservePrice: money('reserve_price'),
    reserveVisible: boolean('reserve_visible').notNull().default(false),
    bidIncrement: money('bid_increment').notNull(),
    buyNowPrice: money('buy_now_price'),
    dealerGroupId: uuid('dealer_group_id').references(() => dealerGroups.id),
    buyerFeePctBp: integer('buyer_fee_pct_bp').notNull().default(0),
    buyerFeeFixed: money('buyer_fee_fixed').notNull().default(0),
    sellerFeePctBp: integer('seller_fee_pct_bp').notNull().default(0),
    sellerFeeFixed: money('seller_fee_fixed').notNull().default(0),
    taxType: taxTypeEnum('tax_type').notNull(),
    locationStreet: text('location_street'),
    locationZip: text('location_zip'),
    locationCity: text('location_city'),
    earliestPickup: date('earliest_pickup', { mode: 'string' }),
    antiSnipeMinutes: integer('anti_snipe_minutes').notNull().default(0),
    currentBid: money('current_bid'),
    currentBidderCompanyId: uuid('current_bidder_company_id').references(() => companies.id),
    winningBidId: uuid('winning_bid_id'),
    bidCount: integer('bid_count').notNull().default(0),
    bidderCount: integer('bidder_count').notNull().default(0),
    extensionCount: integer('extension_count').notNull().default(0),
    outcome: auctionOutcomeEnum('outcome'),
    endedAt: ts('ended_at'),
    startedAt: ts('started_at'),
    cancelledReason: text('cancelled_reason'),
    endingSoonNotifiedAt: ts('ending_soon_notified_at'),
    resolvedAt: ts('resolved_at'),
    resolution: text('resolution'),
    relistedFromId: uuid('relisted_from_id'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('auctions_number_uq').on(t.number),
    uniqueIndex('auctions_vehicle_open_uq')
      .on(t.vehicleId)
      .where(sql`${t.status} IN ('DRAFT','SCHEDULED','ACTIVE')`),
    index('auctions_status_starts_idx').on(t.status, t.startsAt),
    index('auctions_status_ends_idx').on(t.status, t.endsAt),
    index('auctions_catalog_idx').on(t.catalogId),
  ],
);

export const auctionBidders = pgTable(
  'auction_bidders',
  {
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    label: integer('label').notNull(),
    firstBidAt: ts('first_bid_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.auctionId, t.companyId] }), uniqueIndex('auction_bidders_label_uq').on(t.auctionId, t.label)],
);

export const bids = pgTable(
  'bids',
  {
    id: id(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    amount: money('amount').notNull(),
    kind: bidKindEnum('kind').notNull(),
    status: bidStatusEnum('status').notNull(),
    sequence: integer('sequence').notNull(),
    serverTime: ts('server_time').notNull().defaultNow(),
    transactionId: uuid('transaction_id').notNull().defaultRandom(),
    /** Idempotenzschlüssel des auslösenden Requests (mehrere Datensätze desselben Requests teilen ihn). */
    clientRequestId: text('client_request_id').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('bids_sequence_uq').on(t.auctionId, t.sequence),
    uniqueIndex('bids_transaction_uq').on(t.transactionId),
    uniqueIndex('bids_winning_uq').on(t.auctionId).where(sql`${t.status} = 'WINNING'`),
    index('bids_company_idx').on(t.companyId, t.auctionId),
    index('bids_request_idx').on(t.auctionId, t.companyId, t.clientRequestId),
  ],
);

export const maximumBids = pgTable(
  'maximum_bids',
  {
    id: id(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    maxAmount: money('max_amount').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('maximum_bids_uq').on(t.auctionId, t.companyId)],
);

export const watchlist = pgTable(
  'watchlist',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.vehicleId] })],
);

// ---------- Verkauf ----------
export const deals = pgTable(
  'deals',
  {
    id: id(),
    dealNumber: text('deal_number').notNull(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    sellerCompanyId: uuid('seller_company_id')
      .notNull()
      .references(() => companies.id),
    buyerCompanyId: uuid('buyer_company_id')
      .notNull()
      .references(() => companies.id),
    winningBidId: uuid('winning_bid_id')
      .notNull()
      .references(() => bids.id),
    salePrice: money('sale_price').notNull(),
    vehicleVat: money('vehicle_vat').notNull(),
    buyerFeeNet: money('buyer_fee_net').notNull(),
    buyerFeeVat: money('buyer_fee_vat').notNull(),
    sellerFeeNet: money('seller_fee_net').notNull(),
    sellerFeeVat: money('seller_fee_vat').notNull(),
    vatRateBp: integer('vat_rate_bp').notNull(),
    buyerTotal: money('buyer_total').notNull(),
    sellerPayout: money('seller_payout').notNull(),
    taxType: taxTypeEnum('tax_type').notNull(),
    vinSnapshot: text('vin_snapshot'),
    vehicleSnapshot: jsonb('vehicle_snapshot').notNull(),
    sellerSnapshot: jsonb('seller_snapshot').notNull(),
    buyerSnapshot: jsonb('buyer_snapshot').notNull(),
    soldAt: ts('sold_at').notNull(),
    auctionEndedAt: ts('auction_ended_at').notNull(),
    /** Wie der Zuschlag zustande kam: AUCTION, BUY_NOW oder MANUAL_ACCEPT (Reserve nachverhandelt). */
    origin: text('origin').notNull(),
    status: dealStatusEnum('status').notNull().default('CREATED'),
    statusBeforeDispute: dealStatusEnum('status_before_dispute'),
    paymentDueAt: ts('payment_due_at'),
    paidAt: ts('paid_at'),
    completedAt: ts('completed_at'),
    cancelledReason: text('cancelled_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('deals_number_uq').on(t.dealNumber),
    uniqueIndex('deals_auction_uq').on(t.auctionId),
    index('deals_buyer_idx').on(t.buyerCompanyId),
    index('deals_seller_idx').on(t.sellerCompanyId),
  ],
);

export const dealStatusHistory = pgTable(
  'deal_status_history',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    fromStatus: dealStatusEnum('from_status'),
    toStatus: dealStatusEnum('to_status').notNull(),
    changedBy: uuid('changed_by').references(() => users.id),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [index('deal_status_history_deal_idx').on(t.dealId)],
);

export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    kind: invoiceKindEnum('kind').notNull(),
    number: text('number').notNull(),
    net: money('net').notNull(),
    vat: money('vat').notNull(),
    gross: money('gross').notNull(),
    issuedAt: ts('issued_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('invoices_number_uq').on(t.number), uniqueIndex('invoices_deal_kind_uq').on(t.dealId, t.kind)],
);

export const generatedDocuments = pgTable(
  'generated_documents',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    kind: generatedDocumentKindEnum('kind').notNull(),
    version: integer('version').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    reason: text('reason').notNull(),
    generatedBy: uuid('generated_by').references(() => users.id),
    generatedAt: ts('generated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('generated_documents_uq').on(t.dealId, t.kind, t.version)],
);

export const pickups = pgTable('pickups', {
  dealId: uuid('deal_id')
    .primaryKey()
    .references(() => deals.id),
  locationStreet: text('location_street'),
  locationZip: text('location_zip'),
  locationCity: text('location_city'),
  contactName: text('contact_name'),
  contactPhone: text('contact_phone'),
  openingHours: text('opening_hours'),
  pickupCode: text('pickup_code').notNull(),
  scheduledAt: ts('scheduled_at'),
  handedOverAt: ts('handed_over_at'),
  handedOverBy: uuid('handed_over_by').references(() => users.id),
  takenOverAt: ts('taken_over_at'),
  takenOverBy: uuid('taken_over_by').references(() => users.id),
  updatedAt: updatedAt(),
});

export const complaints = pgTable(
  'complaints',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    reason: text('reason').notNull(),
    description: text('description').notNull(),
    status: complaintStatusEnum('status').notNull().default('OPEN'),
    resolution: text('resolution'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('complaints_deal_idx').on(t.dealId)],
);

// ---------- System ----------
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    data: jsonb('data'),
    readAt: ts('read_at'),
    emailStatus: text('email_status'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    endpoint: text('endpoint').notNull(),
    keys: jsonb('keys').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('push_subscriptions_endpoint_uq').on(t.endpoint)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    actorCompanyId: uuid('actor_company_id'),
    event: text('event').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_created_idx').on(t.createdAt),
    index('audit_logs_actor_idx').on(t.actorUserId),
    index('audit_logs_event_idx').on(t.event),
  ],
);

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by').references(() => users.id),
  updatedAt: updatedAt(),
});

export const jobs = pgTable(
  'jobs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    status: jobStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    runAt: ts('run_at').notNull().defaultNow(),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    dedupeKey: text('dedupe_key'),
    /** Kleinere Zahl = früher. Geschäftskritische Jobs (Deal-PDFs, Bildverarbeitung) vor Benachrichtigungen. */
    priority: integer('priority').notNull().default(100),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.priority, t.runAt, t.id),
    uniqueIndex('jobs_dedupe_uq').on(t.dedupeKey).where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('PENDING','RUNNING')`),
  ],
);
