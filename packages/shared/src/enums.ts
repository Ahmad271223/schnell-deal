/**
 * Zentrale Enum-Definitionen. Diese Arrays sind die einzige Quelle für
 * Postgres-Enums (apps/api/src/core/db/schema.ts), Zod-Schemas und UI-Labels.
 */

export const PLATFORM_ROLES = ['SUPERADMIN', 'ADMIN', 'INSPECTOR', 'USER'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const COMPANY_TYPES = ['DEALERSHIP', 'DEALER'] as const;
export type CompanyType = (typeof COMPANY_TYPES)[number];

export const COMPANY_ROLES = ['OWNER', 'MANAGER', 'MEMBER'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

export const COMPANY_STATUSES = [
  'REGISTRATION_STARTED',
  'DOCUMENTS_MISSING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'BLOCKED',
] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export const BIDDING_STATUSES = ['VIEW_ONLY', 'CAN_BID', 'TEMP_BLOCKED', 'BLOCKED'] as const;
export type BiddingStatus = (typeof BIDDING_STATUSES)[number];

export const COMPANY_DOCUMENT_KINDS = ['TRADE_LICENSE', 'ID_DOCUMENT', 'REGISTER_EXTRACT', 'OTHER'] as const;
export type CompanyDocumentKind = (typeof COMPANY_DOCUMENT_KINDS)[number];

export const LEGAL_KINDS = ['TERMS', 'BIDDER_TERMS', 'PRIVACY', 'IMPRINT'] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export const INSPECTION_STATUSES = [
  'NEW',
  'PLANNED',
  'ASSIGNED',
  'EN_ROUTE',
  'ON_SITE',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const VEHICLE_STATUSES = [
  'DRAFT',
  'INSPECTION_IN_PROGRESS',
  'WAITING_REVIEW',
  'REQUIRES_CORRECTION',
  'APPROVED',
  'SCHEDULED',
  'IN_AUCTION',
  'SOLD',
  'UNSOLD',
  'COMPLETED',
] as const;
export type VehicleStatus = (typeof VEHICLE_STATUSES)[number];

export const AUCTION_STATUSES = ['DRAFT', 'SCHEDULED', 'ACTIVE', 'ENDED', 'CANCELLED'] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

export const AUCTION_OUTCOMES = ['SOLD', 'BUY_NOW', 'RESERVE_NOT_MET', 'NO_BIDS', 'CANCELLED'] as const;
export type AuctionOutcome = (typeof AUCTION_OUTCOMES)[number];

export const DEAL_STATUSES = [
  'CREATED',
  'PAYMENT_PENDING',
  'PAID',
  'READY_FOR_PICKUP',
  'PICKUP_SCHEDULED',
  'PICKED_UP',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const CATALOG_STATUSES = ['DRAFT', 'PUBLISHED', 'CLOSED'] as const;
export type CatalogStatus = (typeof CATALOG_STATUSES)[number];

export const BID_KINDS = ['MANUAL', 'PROXY', 'BUY_NOW'] as const;
export type BidKind = (typeof BID_KINDS)[number];

export const BID_STATUSES = ['WINNING', 'OUTBID'] as const;
export type BidStatus = (typeof BID_STATUSES)[number];

export const TAX_TYPES = ['REGELBESTEUERT', 'DIFFERENZBESTEUERT'] as const;
export type TaxType = (typeof TAX_TYPES)[number];

export const ANTI_SNIPE_OPTIONS = [0, 1, 2, 3, 5] as const;
export type AntiSnipeMinutes = (typeof ANTI_SNIPE_OPTIONS)[number];

export const AUCTION_DURATIONS_HOURS = [12, 24, 48] as const;

export const VIN_CHECKS = ['VALID', 'INVALID', 'UNVERIFIED'] as const;
export type VinCheck = (typeof VIN_CHECKS)[number];

export const FUEL_TYPES = [
  'PETROL',
  'DIESEL',
  'ELECTRIC',
  'HYBRID_PETROL',
  'HYBRID_DIESEL',
  'PLUGIN_HYBRID',
  'LPG',
  'CNG',
  'HYDROGEN',
  'OTHER',
] as const;
export type FuelType = (typeof FUEL_TYPES)[number];

export const TRANSMISSIONS = ['MANUAL', 'AUTOMATIC', 'SEMI_AUTOMATIC'] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const DRIVE_TYPES = ['FWD', 'RWD', 'AWD'] as const;
export type DriveType = (typeof DRIVE_TYPES)[number];

export const BODY_TYPES = [
  'SEDAN',
  'ESTATE',
  'HATCHBACK',
  'SUV',
  'COUPE',
  'CONVERTIBLE',
  'VAN',
  'MINIVAN',
  'PICKUP',
  'TRANSPORTER',
  'OTHER',
] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const EMISSION_CLASSES = ['EURO_1', 'EURO_2', 'EURO_3', 'EURO_4', 'EURO_5', 'EURO_6', 'EURO_6C', 'EURO_6D_TEMP', 'EURO_6D', 'EURO_6E'] as const;
export type EmissionClass = (typeof EMISSION_CLASSES)[number];

/** Art des letzten Halters laut Fahrzeugpapieren (Angabe bei der Aufnahme). */
export const HOLDER_TYPES = ['PRIVATE', 'COMMERCIAL'] as const;
export type HolderType = (typeof HOLDER_TYPES)[number];

/** Pflicht-Fotosatz (Spec §10). Reihenfolge = Aufnahme-Reihenfolge in der App. */
export const REQUIRED_PHOTO_SLOTS = [
  'FRONT_LEFT_45',
  'FRONT',
  'FRONT_RIGHT_45',
  'RIGHT_SIDE',
  'REAR_RIGHT_45',
  'REAR',
  'REAR_LEFT_45',
  'LEFT_SIDE',
  'ROOF',
  'ENGINE_BAY',
  'TRUNK_OPEN',
  'DRIVER_SEAT',
  'DASHBOARD',
  'ODOMETER',
  'INFOTAINMENT',
  'FRONT_SEATS',
  'REAR_SEATS',
  'HEADLINER',
  'KEYS',
  'VIN_PLATE',
  'RIM_FL',
  'RIM_FR',
  'RIM_RL',
  'RIM_RR',
  'TIRE_FL',
  'TIRE_FR',
  'TIRE_RL',
  'TIRE_RR',
] as const;
export type RequiredPhotoSlot = (typeof REQUIRED_PHOTO_SLOTS)[number];

export const PHOTO_SLOTS = [...REQUIRED_PHOTO_SLOTS, 'EXTRA', 'DAMAGE', 'PDR_LINEBOARD'] as const;
export type PhotoSlot = (typeof PHOTO_SLOTS)[number];

/** Außenaufnahmen, bei denen das Fahrzeug vollständig im Bild sein soll. */
export const EXTERIOR_PHOTO_SLOTS: readonly PhotoSlot[] = [
  'FRONT_LEFT_45',
  'FRONT',
  'FRONT_RIGHT_45',
  'RIGHT_SIDE',
  'REAR_RIGHT_45',
  'REAR',
  'REAR_LEFT_45',
  'LEFT_SIDE',
];

export const PHOTO_QUALITIES = ['PENDING', 'OK', 'BLURRY', 'DARK', 'BRIGHT', 'CROPPED'] as const;
export type PhotoQuality = (typeof PHOTO_QUALITIES)[number];

export const UPLOAD_STATUSES = ['UPLOADED', 'PROCESSED', 'FAILED'] as const;
export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const VEHICLE_DOCUMENT_KINDS = [
  'REGISTRATION_1',
  'REGISTRATION_2',
  'SERVICE_BOOK',
  'HU_REPORT',
  'APPRAISAL',
  'OTHER',
] as const;
export type VehicleDocumentKind = (typeof VEHICLE_DOCUMENT_KINDS)[number];

/** Dokumentarten, die als sensibel gelten und standardmäßig NICHT für Käufer sichtbar sind. */
export const SENSITIVE_VEHICLE_DOCUMENT_KINDS: readonly VehicleDocumentKind[] = ['REGISTRATION_1', 'REGISTRATION_2'];

export const DAMAGE_ZONES = [
  'FRONT_BUMPER',
  'HOOD',
  'WINDSHIELD',
  'ROOF',
  'REAR_WINDOW',
  'TRUNK_LID',
  'REAR_BUMPER',
  'FENDER_FL',
  'FENDER_FR',
  'DOOR_FL',
  'DOOR_FR',
  'DOOR_RL',
  'DOOR_RR',
  'QUARTER_RL',
  'QUARTER_RR',
  'SILL_LEFT',
  'SILL_RIGHT',
  'MIRROR_LEFT',
  'MIRROR_RIGHT',
  'HEADLIGHT_LEFT',
  'HEADLIGHT_RIGHT',
  'TAILLIGHT_LEFT',
  'TAILLIGHT_RIGHT',
  'WHEEL_FL',
  'WHEEL_FR',
  'WHEEL_RL',
  'WHEEL_RR',
  'INTERIOR_FRONT',
  'INTERIOR_REAR',
  'ENGINE',
  'UNDERBODY',
  'OTHER',
] as const;
export type DamageZone = (typeof DAMAGE_ZONES)[number];

export const DAMAGE_KINDS = [
  'SCRATCH',
  'DENT',
  'BUMP',
  'PAINT_DAMAGE',
  'STONE_CHIP',
  'RUST',
  'CRACK',
  'BREAK',
  'HAIL',
  'RIM_DAMAGE',
  'TIRE_DAMAGE',
  'GLASS_DAMAGE',
  'MISSING_PART',
  'INTERIOR_DAMAGE',
  'MECHANICAL',
  'WARNING_LIGHT',
  'OTHER',
] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export const DAMAGE_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type DamageSeverity = (typeof DAMAGE_SEVERITIES)[number];

export const PAINT_POINTS = [
  'HOOD',
  'FENDER_FL',
  'DOOR_FL',
  'DOOR_RL',
  'QUARTER_RL',
  'TRUNK_LID',
  'QUARTER_RR',
  'DOOR_RR',
  'DOOR_FR',
  'FENDER_FR',
  'ROOF',
] as const;
export type PaintPoint = (typeof PAINT_POINTS)[number];

export const TIRE_POSITIONS = ['FL', 'FR', 'RL', 'RR'] as const;
export type TirePosition = (typeof TIRE_POSITIONS)[number];

export const TIRE_SEASONS = ['SUMMER', 'WINTER', 'ALL_SEASON'] as const;
export type TireSeason = (typeof TIRE_SEASONS)[number];

export const DTC_STATUSES = ['PERMANENT', 'PENDING', 'CURRENT', 'UNKNOWN'] as const;
export type DtcStatus = (typeof DTC_STATUSES)[number];

export const BATTERY_KINDS = ['ICE', 'EV', 'HYBRID'] as const;
export type BatteryKind = (typeof BATTERY_KINDS)[number];

export const FEATURES = [
  'ENGINE_STARTS',
  'DRIVABLE',
  'TRANSMISSION',
  'AIR_CONDITIONING',
  'HEATING',
  'INFOTAINMENT',
  'NAVIGATION',
  'WINDOWS',
  'CENTRAL_LOCKING',
  'LIGHTING',
  'ELECTRIC_MIRRORS',
  'SEAT_HEATING',
  'REAR_CAMERA',
  'PARKING_SENSORS',
  'OTHER_EQUIPMENT',
] as const;
export type Feature = (typeof FEATURES)[number];

export const FEATURE_RESULTS = ['OK', 'DEFECT', 'NOT_CHECKED', 'NOT_PRESENT'] as const;
export type FeatureResult = (typeof FEATURE_RESULTS)[number];

export const GENERATED_DOCUMENT_KINDS = ['BUYER', 'SELLER', 'INTERNAL'] as const;
export type GeneratedDocumentKind = (typeof GENERATED_DOCUMENT_KINDS)[number];

export const INVOICE_KINDS = ['BUYER_FEE', 'SELLER_FEE'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];

export const COMPLAINT_STATUSES = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'REJECTED'] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'ACCOUNT_APPROVED',
  'ACCOUNT_REJECTED',
  'ACCOUNT_BLOCKED',
  'ACCOUNT_DOCUMENTS_MISSING',
  'COMPANY_REGISTERED',
  'INSPECTION_REQUEST_CREATED',
  'INSPECTION_SCHEDULED',
  'INSPECTOR_ASSIGNED',
  'INSPECTION_CANCELLED',
  'VEHICLE_WAITING_REVIEW',
  'VEHICLE_APPROVED',
  'VEHICLE_RETURNED',
  'AUCTION_STARTED',
  'OUTBID',
  'AUCTION_ENDING_SOON',
  'AUCTION_EXTENDED',
  'AUCTION_WON',
  'AUCTION_LOST',
  'AUCTION_SOLD',
  'RESERVE_NOT_MET',
  'AUCTION_CANCELLED',
  'DEAL_ACTION_REQUIRED',
  'DEAL_STATUS_CHANGED',
  'DOCUMENTS_READY',
  'PICKUP_READY',
  'COMPLAINT_UPDATE',
  'SYSTEM_ALERT',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const AUDIT_EVENTS = [
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'PASSWORD_CHANGED',
  'REGISTER',
  'COMPANY_CREATED',
  'COMPANY_UPDATED',
  'COMPANY_STATUS_CHANGED',
  'COMPANY_DOCUMENT_UPLOADED',
  'BIDDING_STATUS_CHANGED',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_LOCKED',
  'USER_UNLOCKED',
  'LEGAL_PUBLISHED',
  'LEGAL_ACCEPTED',
  'INSPECTION_CREATED',
  'INSPECTION_SCHEDULED',
  'INSPECTION_ASSIGNED',
  'INSPECTION_STATUS_CHANGED',
  'VEHICLE_CREATED',
  'VEHICLE_UPDATED',
  'VEHICLE_STATUS_CHANGED',
  'VEHICLE_CORRECTED',
  'VEHICLE_REVIEWED',
  'VEHICLE_PHOTO_UPLOADED',
  'VEHICLE_PHOTO_REPLACED',
  'VEHICLE_DOCUMENT_UPLOADED',
  'VEHICLE_DOCUMENT_RELEASED',
  'DIAGNOSTIC_REPORT_ADDED',
  'DEALER_GROUP_CHANGED',
  'CATALOG_CHANGED',
  'AUCTION_CREATED',
  'AUCTION_UPDATED',
  'PRICE_CHANGED',
  'AUCTION_STATUS_CHANGED',
  'AUCTION_EXTENDED',
  'AUCTION_ENDED',
  'BID_PLACED',
  'MAX_BID_SET',
  'MAX_BID_REMOVED',
  'DEAL_CREATED',
  'DEAL_STATUS_CHANGED',
  'PDF_GENERATED',
  'PDF_FAILED',
  'PICKUP_UPDATED',
  'PICKUP_CONFIRMED',
  'COMPLAINT_OPENED',
  'COMPLAINT_UPDATED',
  'SETTINGS_CHANGED',
  'FILE_REJECTED',
  'JOB_FAILED',
  'ADMIN_ACTION',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];
