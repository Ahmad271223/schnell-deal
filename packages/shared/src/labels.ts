import type {
  AuctionOutcome,
  AuctionStatus,
  BiddingStatus,
  BodyType,
  EmissionClass,
  HolderType,
  CompanyRole,
  CompanyStatus,
  ComplaintStatus,
  DamageKind,
  DamageSeverity,
  DamageZone,
  DealStatus,
  DriveType,
  DtcStatus,
  Feature,
  FeatureResult,
  FuelType,
  InspectionStatus,
  LegalKind,
  PaintPoint,
  PhotoQuality,
  PhotoSlot,
  PlatformRole,
  TaxType,
  TirePosition,
  TireSeason,
  Transmission,
  VehicleDocumentKind,
  VehicleStatus,
  CompanyDocumentKind,
  BatteryKind,
} from './enums';

/** Tonalität für Status-Badges. Farbe wird IMMER zusammen mit Text (und Icon) angezeigt (Spec §54). */
export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  SUPERADMIN: 'Superadmin',
  ADMIN: 'Administrator',
  INSPECTOR: 'Außendienst',
  USER: 'Firmenbenutzer',
};

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  OWNER: 'Inhaber/Geschäftsführung',
  MANAGER: 'Leitung',
  MEMBER: 'Mitarbeiter',
};

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, [string, Tone]> = {
  REGISTRATION_STARTED: ['Registrierung begonnen', 'neutral'],
  DOCUMENTS_MISSING: ['Unterlagen fehlen', 'warning'],
  IN_REVIEW: ['Prüfung läuft', 'info'],
  APPROVED: ['Freigegeben', 'success'],
  REJECTED: ['Abgelehnt', 'danger'],
  BLOCKED: ['Gesperrt', 'danger'],
};

export const BIDDING_STATUS_LABELS: Record<BiddingStatus, [string, Tone]> = {
  VIEW_ONLY: ['Darf nur ansehen', 'neutral'],
  CAN_BID: ['Darf bieten', 'success'],
  TEMP_BLOCKED: ['Temporär gesperrt', 'warning'],
  BLOCKED: ['Vollständig gesperrt', 'danger'],
};

export const INSPECTION_STATUS_LABELS: Record<InspectionStatus, [string, Tone]> = {
  NEW: ['Neu', 'info'],
  PLANNED: ['Geplant', 'info'],
  ASSIGNED: ['Mitarbeiter zugewiesen', 'progress'],
  EN_ROUTE: ['Unterwegs', 'progress'],
  ON_SITE: ['Vor Ort', 'progress'],
  IN_PROGRESS: ['Aufnahme läuft', 'progress'],
  COMPLETED: ['Abgeschlossen', 'success'],
  CANCELLED: ['Storniert', 'neutral'],
};

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, [string, Tone]> = {
  DRAFT: ['Entwurf', 'neutral'],
  INSPECTION_IN_PROGRESS: ['Aufnahme läuft', 'progress'],
  WAITING_REVIEW: ['Wartet auf Admin-Prüfung', 'warning'],
  REQUIRES_CORRECTION: ['Korrektur erforderlich', 'danger'],
  APPROVED: ['Freigegeben', 'success'],
  SCHEDULED: ['Auktion geplant', 'info'],
  IN_AUCTION: ['In Auktion', 'progress'],
  SOLD: ['Verkauft', 'success'],
  UNSOLD: ['Nicht verkauft', 'warning'],
  COMPLETED: ['Abgeschlossen', 'neutral'],
};

export const AUCTION_STATUS_LABELS: Record<AuctionStatus, [string, Tone]> = {
  DRAFT: ['Entwurf', 'neutral'],
  SCHEDULED: ['Geplant', 'info'],
  ACTIVE: ['Läuft', 'progress'],
  ENDED: ['Beendet', 'neutral'],
  CANCELLED: ['Abgebrochen', 'danger'],
};

export const AUCTION_OUTCOME_LABELS: Record<AuctionOutcome, [string, Tone]> = {
  SOLD: ['Verkauft', 'success'],
  BUY_NOW: ['Sofortkauf', 'success'],
  RESERVE_NOT_MET: ['Mindestpreis nicht erreicht', 'warning'],
  NO_BIDS: ['Keine Gebote', 'neutral'],
  CANCELLED: ['Abgebrochen', 'danger'],
};

export const DEAL_STATUS_LABELS: Record<DealStatus, [string, Tone]> = {
  CREATED: ['Verkauft', 'success'],
  PAYMENT_PENDING: ['Zahlung ausstehend', 'warning'],
  PAID: ['Bezahlt', 'info'],
  READY_FOR_PICKUP: ['Abholbereit', 'info'],
  PICKUP_SCHEDULED: ['Abholung geplant', 'progress'],
  PICKED_UP: ['Abgeholt', 'success'],
  COMPLETED: ['Abgeschlossen', 'neutral'],
  DISPUTED: ['Reklamation', 'danger'],
  CANCELLED: ['Storniert', 'danger'],
};

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, [string, Tone]> = {
  OPEN: ['Offen', 'warning'],
  IN_REVIEW: ['In Bearbeitung', 'info'],
  RESOLVED: ['Gelöst', 'success'],
  REJECTED: ['Abgelehnt', 'neutral'],
};

export const LEGAL_KIND_LABELS: Record<LegalKind, string> = {
  TERMS: 'Allgemeine Geschäftsbedingungen',
  BIDDER_TERMS: 'Bieter- und Auktionsbedingungen',
  PRIVACY: 'Datenschutzerklärung',
};

export const COMPANY_DOCUMENT_KIND_LABELS: Record<CompanyDocumentKind, string> = {
  TRADE_LICENSE: 'Gewerbenachweis',
  ID_DOCUMENT: 'Ausweisdokument Verantwortliche/r',
  REGISTER_EXTRACT: 'Handelsregisterauszug',
  OTHER: 'Sonstiges',
};

export const PHOTO_SLOT_LABELS: Record<PhotoSlot, string> = {
  FRONT_LEFT_45: 'Vorne links 45°',
  FRONT: 'Frontal',
  FRONT_RIGHT_45: 'Vorne rechts 45°',
  RIGHT_SIDE: 'Rechte Seite',
  REAR_RIGHT_45: 'Hinten rechts 45°',
  REAR: 'Hinten',
  REAR_LEFT_45: 'Hinten links 45°',
  LEFT_SIDE: 'Linke Seite',
  ROOF: 'Dach',
  ENGINE_BAY: 'Motorraum',
  TRUNK_OPEN: 'Kofferraum offen',
  DRIVER_SEAT: 'Fahrerplatz',
  DASHBOARD: 'Armaturenbrett',
  ODOMETER: 'Tacho',
  INFOTAINMENT: 'Infotainment',
  FRONT_SEATS: 'Vordersitze',
  REAR_SEATS: 'Rückbank',
  HEADLINER: 'Himmel',
  KEYS: 'Schlüssel',
  VIN_PLATE: 'FIN',
  RIM_FL: 'Felge vorne links',
  RIM_FR: 'Felge vorne rechts',
  RIM_RL: 'Felge hinten links',
  RIM_RR: 'Felge hinten rechts',
  TIRE_FL: 'Reifen vorne links',
  TIRE_FR: 'Reifen vorne rechts',
  TIRE_RL: 'Reifen hinten links',
  TIRE_RR: 'Reifen hinten rechts',
  EXTRA: 'Zusatzfoto',
  DAMAGE: 'Schadenfoto',
  PDR_LINEBOARD: 'PDR-Lineboard',
};

export const PHOTO_QUALITY_LABELS: Record<PhotoQuality, [string, Tone]> = {
  PENDING: ['Wird geprüft', 'neutral'],
  OK: ['In Ordnung', 'success'],
  BLURRY: ['Unscharf/verwackelt', 'danger'],
  DARK: ['Zu dunkel', 'danger'],
  BRIGHT: ['Zu hell', 'danger'],
  CROPPED: ['Fahrzeug nicht vollständig im Bild', 'danger'],
};

export const VEHICLE_DOCUMENT_KIND_LABELS: Record<VehicleDocumentKind, string> = {
  REGISTRATION_1: 'Zulassungsbescheinigung Teil I',
  REGISTRATION_2: 'Zulassungsbescheinigung Teil II',
  SERVICE_BOOK: 'Serviceheft',
  HU_REPORT: 'HU-Bericht',
  APPRAISAL: 'Gutachten',
  OTHER: 'Sonstige Unterlage',
};

export const DAMAGE_ZONE_LABELS: Record<DamageZone, string> = {
  FRONT_BUMPER: 'Stoßfänger vorne',
  HOOD: 'Motorhaube',
  WINDSHIELD: 'Windschutzscheibe',
  ROOF: 'Dach',
  REAR_WINDOW: 'Heckscheibe',
  TRUNK_LID: 'Kofferraumdeckel/Heckklappe',
  REAR_BUMPER: 'Stoßfänger hinten',
  FENDER_FL: 'Kotflügel vorne links',
  FENDER_FR: 'Kotflügel vorne rechts',
  DOOR_FL: 'Tür vorne links',
  DOOR_FR: 'Tür vorne rechts',
  DOOR_RL: 'Tür hinten links',
  DOOR_RR: 'Tür hinten rechts',
  QUARTER_RL: 'Seitenteil hinten links',
  QUARTER_RR: 'Seitenteil hinten rechts',
  SILL_LEFT: 'Schweller links',
  SILL_RIGHT: 'Schweller rechts',
  MIRROR_LEFT: 'Außenspiegel links',
  MIRROR_RIGHT: 'Außenspiegel rechts',
  HEADLIGHT_LEFT: 'Scheinwerfer links',
  HEADLIGHT_RIGHT: 'Scheinwerfer rechts',
  TAILLIGHT_LEFT: 'Rückleuchte links',
  TAILLIGHT_RIGHT: 'Rückleuchte rechts',
  WHEEL_FL: 'Rad vorne links',
  WHEEL_FR: 'Rad vorne rechts',
  WHEEL_RL: 'Rad hinten links',
  WHEEL_RR: 'Rad hinten rechts',
  INTERIOR_FRONT: 'Innenraum vorne',
  INTERIOR_REAR: 'Innenraum hinten',
  ENGINE: 'Motor/Antrieb',
  UNDERBODY: 'Unterboden',
  OTHER: 'Sonstiger Bereich',
};

export const DAMAGE_KIND_LABELS: Record<DamageKind, string> = {
  SCRATCH: 'Kratzer',
  DENT: 'Delle',
  BUMP: 'Beule',
  PAINT_DAMAGE: 'Lackschaden',
  STONE_CHIP: 'Steinschlag',
  RUST: 'Rost',
  CRACK: 'Riss',
  BREAK: 'Bruch',
  HAIL: 'Hagel',
  RIM_DAMAGE: 'Beschädigte Felge',
  TIRE_DAMAGE: 'Beschädigter Reifen',
  GLASS_DAMAGE: 'Glasschaden',
  MISSING_PART: 'Fehlendes Teil',
  INTERIOR_DAMAGE: 'Innenraumschaden',
  MECHANICAL: 'Mechanisches Problem',
  WARNING_LIGHT: 'Warnleuchte',
  OTHER: 'Sonstiger Schaden',
};

export const DAMAGE_SEVERITY_LABELS: Record<DamageSeverity, string> = {
  LOW: 'Leicht',
  MEDIUM: 'Mittel',
  HIGH: 'Stark',
};

export const PAINT_POINT_LABELS: Record<PaintPoint, string> = {
  HOOD: 'Motorhaube',
  FENDER_FL: 'Kotflügel VL',
  DOOR_FL: 'Tür VL',
  DOOR_RL: 'Tür HL',
  QUARTER_RL: 'Seitenteil HL',
  TRUNK_LID: 'Kofferraumdeckel',
  QUARTER_RR: 'Seitenteil HR',
  DOOR_RR: 'Tür HR',
  DOOR_FR: 'Tür VR',
  FENDER_FR: 'Kotflügel VR',
  ROOF: 'Dach',
};

export const TIRE_POSITION_LABELS: Record<TirePosition, string> = {
  FL: 'Vorne links',
  FR: 'Vorne rechts',
  RL: 'Hinten links',
  RR: 'Hinten rechts',
};

export const TIRE_SEASON_LABELS: Record<TireSeason, string> = {
  SUMMER: 'Sommer',
  WINTER: 'Winter',
  ALL_SEASON: 'Ganzjahr',
};

export const DTC_STATUS_LABELS: Record<DtcStatus, string> = {
  PERMANENT: 'Permanent',
  PENDING: 'Pending',
  CURRENT: 'Aktuell',
  UNKNOWN: 'Unbekannt',
};

export const BATTERY_KIND_LABELS: Record<BatteryKind, string> = {
  ICE: 'Verbrenner (12 V)',
  EV: 'Elektro',
  HYBRID: 'Hybrid',
};

export const FEATURE_LABELS: Record<Feature, string> = {
  ENGINE_STARTS: 'Motor startet',
  DRIVABLE: 'Fahrzeug fahrbereit',
  TRANSMISSION: 'Getriebe funktionsfähig',
  AIR_CONDITIONING: 'Klimaanlage',
  HEATING: 'Heizung',
  INFOTAINMENT: 'Infotainment',
  NAVIGATION: 'Navigation',
  WINDOWS: 'Fensterheber',
  CENTRAL_LOCKING: 'Zentralverriegelung',
  LIGHTING: 'Beleuchtung',
  ELECTRIC_MIRRORS: 'Elektrische Spiegel',
  SEAT_HEATING: 'Sitzheizung',
  REAR_CAMERA: 'Rückfahrkamera',
  PARKING_SENSORS: 'Parksensoren',
  OTHER_EQUIPMENT: 'Weitere Ausstattung',
};

export const FEATURE_RESULT_LABELS: Record<FeatureResult, [string, Tone]> = {
  OK: ['Funktioniert', 'success'],
  DEFECT: ['Funktioniert nicht', 'danger'],
  NOT_CHECKED: ['Nicht geprüft', 'neutral'],
  NOT_PRESENT: ['Nicht vorhanden', 'neutral'],
};

export const FUEL_LABELS: Record<FuelType, string> = {
  PETROL: 'Benzin',
  DIESEL: 'Diesel',
  ELECTRIC: 'Elektro',
  HYBRID_PETROL: 'Hybrid (Benzin)',
  HYBRID_DIESEL: 'Hybrid (Diesel)',
  PLUGIN_HYBRID: 'Plug-in-Hybrid',
  LPG: 'Autogas (LPG)',
  CNG: 'Erdgas (CNG)',
  HYDROGEN: 'Wasserstoff',
  OTHER: 'Sonstige',
};

export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  MANUAL: 'Schaltgetriebe',
  AUTOMATIC: 'Automatik',
  SEMI_AUTOMATIC: 'Halbautomatik',
};

export const DRIVE_LABELS: Record<DriveType, string> = {
  FWD: 'Frontantrieb',
  RWD: 'Heckantrieb',
  AWD: 'Allrad',
};

export const EMISSION_CLASS_LABELS: Record<EmissionClass, string> = {
  EURO_1: 'Euro 1',
  EURO_2: 'Euro 2',
  EURO_3: 'Euro 3',
  EURO_4: 'Euro 4',
  EURO_5: 'Euro 5',
  EURO_6: 'Euro 6',
  EURO_6C: 'Euro 6c',
  EURO_6D_TEMP: 'Euro 6d-TEMP',
  EURO_6D: 'Euro 6d',
  EURO_6E: 'Euro 6e',
};

export const HOLDER_TYPE_LABELS: Record<HolderType, string> = { PRIVATE: 'Privat', COMMERCIAL: 'Gewerblich' };

export const BODY_LABELS: Record<BodyType, string> = {
  SEDAN: 'Limousine',
  ESTATE: 'Kombi',
  HATCHBACK: 'Kleinwagen/Schrägheck',
  SUV: 'SUV/Geländewagen',
  COUPE: 'Coupé',
  CONVERTIBLE: 'Cabrio',
  VAN: 'Van',
  MINIVAN: 'Kompaktvan',
  PICKUP: 'Pick-up',
  TRANSPORTER: 'Transporter',
  OTHER: 'Sonstige',
};

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  REGELBESTEUERT: 'Regelbesteuert (Preise netto zzgl. MwSt.)',
  DIFFERENZBESTEUERT: 'Differenzbesteuert nach § 25a UStG',
};
