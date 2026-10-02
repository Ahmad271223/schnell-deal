import { z } from 'zod';
import {
  ANTI_SNIPE_OPTIONS,
  BATTERY_KINDS,
  BIDDING_STATUSES,
  BODY_TYPES,
  EMISSION_CLASSES,
  HOLDER_TYPES,
  COMPANY_ROLES,
  COMPLAINT_STATUSES,
  DAMAGE_KINDS,
  DAMAGE_SEVERITIES,
  DAMAGE_ZONES,
  DEAL_STATUSES,
  DRIVE_TYPES,
  DTC_STATUSES,
  FEATURES,
  FEATURE_RESULTS,
  FUEL_TYPES,
  LEGAL_KINDS,
  PAINT_POINTS,
  PLATFORM_ROLES,
  TAX_TYPES,
  TIRE_POSITIONS,
  TIRE_SEASONS,
  TRANSMISSIONS,
} from './enums';

const trimmed = (max = 200) => z.string().trim().max(max);
const required = (max = 200) => z.string().trim().min(1, 'Pflichtfeld').max(max);
const optionalText = (max = 200) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const passwordSchema = z
  .string()
  .min(10, 'Mindestens 10 Zeichen')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v), 'Mindestens ein Buchstabe und eine Ziffer');

export const emailSchema = z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse').max(200);
export const phoneSchema = z
  .string()
  .trim()
  .min(5, 'Ungültige Telefonnummer')
  .max(40)
  .regex(/^[+0-9 ()/-]+$/, 'Ungültige Telefonnummer');
export const zipSchema = z.string().trim().regex(/^[0-9]{4,5}$/, 'Ungültige PLZ');
export const uuidSchema = z.string().uuid();
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum im Format JJJJ-MM-TT');
const timeString = z.string().regex(/^\d{2}:\d{2}$/, 'Uhrzeit im Format HH:MM');
const isoDateTime = z.string().datetime({ offset: true });
const cents = z.number().int().min(0).max(100_000_000_00);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

const companyBase = {
  name: required(200),
  legalForm: required(60),
  street: required(120),
  houseNumber: required(20),
  zip: zipSchema,
  city: required(100),
  website: optionalText(200),
  registerNumber: optionalText(60),
  vatId: optionalText(30),
};

const contactPerson = {
  firstName: required(80),
  lastName: required(80),
  phone: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
};

const legalAcceptance = {
  acceptTerms: z.literal(true, { errorMap: () => ({ message: 'AGB müssen akzeptiert werden' }) }),
  acceptPrivacy: z.literal(true, { errorMap: () => ({ message: 'Datenschutz muss akzeptiert werden' }) }),
};

export const registerDealershipSchema = z.object({
  ...companyBase,
  brands: z.array(trimmed(60)).max(40).default([]),
  ...contactPerson,
  ...legalAcceptance,
});
export type RegisterDealershipInput = z.infer<typeof registerDealershipSchema>;

export const registerDealerSchema = z.object({
  ...companyBase,
  vatId: required(30),
  tradeType: required(120),
  bankIban: optionalText(40),
  ...contactPerson,
  ...legalAcceptance,
  acceptBidderTerms: z.literal(true, { errorMap: () => ({ message: 'Bieterbedingungen müssen akzeptiert werden' }) }),
});
export type RegisterDealerInput = z.infer<typeof registerDealerSchema>;

export const updateCompanySchema = z
  .object({
    ...companyBase,
    brands: z.array(trimmed(60)).max(40),
    tradeType: optionalText(120),
    bankIban: optionalText(40),
    contactFirstName: required(80),
    contactLastName: required(80),
    contactPhone: phoneSchema,
    contactEmail: emailSchema,
  })
  .partial();

export const companyStatusActionSchema = z.object({
  action: z.enum(['approve', 'reject', 'block', 'unblock', 'request_documents', 'reopen']),
  note: optionalText(1000),
});

export const biddingStatusSchema = z.object({
  status: z.enum(BIDDING_STATUSES),
  blockedUntil: isoDateTime.optional().nullable(),
  note: optionalText(1000),
});

export const createCompanyUserSchema = z.object({
  firstName: required(80),
  lastName: required(80),
  email: emailSchema,
  phone: phoneSchema.optional().nullable(),
  jobTitle: optionalText(80),
  companyRole: z.enum(COMPANY_ROLES),
  password: passwordSchema,
});

export const updateCompanyUserSchema = z.object({
  firstName: required(80).optional(),
  lastName: required(80).optional(),
  phone: phoneSchema.optional().nullable(),
  jobTitle: optionalText(80),
  companyRole: z.enum(COMPANY_ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const adminCreateUserSchema = z.object({
  firstName: required(80),
  lastName: required(80),
  email: emailSchema,
  phone: phoneSchema.optional().nullable(),
  platformRole: z.enum(PLATFORM_ROLES),
  password: passwordSchema,
  companyId: uuidSchema.optional().nullable(),
  companyRole: z.enum(COMPANY_ROLES).optional(),
});

export const adminUpdateUserSchema = z.object({
  firstName: required(80).optional(),
  lastName: required(80).optional(),
  phone: phoneSchema.optional().nullable(),
  platformRole: z.enum(PLATFORM_ROLES).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});

export const adminCreateCompanySchema = z.object({
  type: z.enum(['DEALERSHIP', 'DEALER']),
  ...companyBase,
  brands: z.array(trimmed(60)).max(40).default([]),
  tradeType: optionalText(120),
  contactFirstName: required(80),
  contactLastName: required(80),
  contactPhone: phoneSchema,
  contactEmail: emailSchema,
  approve: z.boolean().default(false),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const acceptLegalSchema = z.object({
  legalDocumentIds: z.array(uuidSchema).min(1).max(10),
});

export const createLegalDocumentSchema = z.object({
  kind: z.enum(LEGAL_KINDS),
  version: required(20),
  title: required(200),
  content: z.string().min(1).max(200_000),
  activeFrom: isoDateTime.optional(),
});

// ---------- Aufnahmeanfragen ----------
export const createInspectionRequestSchema = z
  .object({
    vehicleCount: z.number().int().min(1).max(100),
    locationStreet: required(160),
    locationZip: zipSchema,
    locationCity: required(100),
    requestedDate: dateString,
    earliestTime: timeString,
    latestTime: timeString,
    contactName: required(120),
    contactPhone: phoneSchema,
    notes: optionalText(2000),
    vehiclesDrivable: z.boolean(),
    keysAvailable: z.boolean(),
    papersAvailable: z.boolean(),
  })
  .refine((v) => v.earliestTime < v.latestTime, {
    message: 'Späteste Uhrzeit muss nach der frühesten liegen',
    path: ['latestTime'],
  });
export type CreateInspectionRequestInput = z.infer<typeof createInspectionRequestSchema>;

export const scheduleInspectionSchema = z.object({ scheduledAt: isoDateTime, note: optionalText(500) });
export const assignInspectionSchema = z.object({
  inspectorUserId: uuidSchema,
  scheduledAt: isoDateTime.optional(),
  note: optionalText(500),
});
export const inspectorStatusSchema = z.object({ status: z.enum(['EN_ROUTE', 'ON_SITE', 'IN_PROGRESS', 'COMPLETED']) });
export const cancelSchema = z.object({ reason: required(500) });

// ---------- Fahrzeuge ----------
const year = z.number().int().min(1950).max(2100);
export const vehicleDataSchema = z
  .object({
    licensePlate: optionalText(20),
    make: required(60),
    model: required(80),
    variant: optionalText(120),
    firstRegistration: dateString.nullable(),
    mileageKm: z.number().int().min(0).max(2_000_000),
    fuel: z.enum(FUEL_TYPES),
    powerKw: z.number().int().min(1).max(2000).nullable(),
    displacementCcm: z.number().int().min(0).max(20000).nullable(),
    transmission: z.enum(TRANSMISSIONS),
    drive: z.enum(DRIVE_TYPES).nullable(),
    body: z.enum(BODY_TYPES).nullable(),
    color: optionalText(60),
    doors: z.number().int().min(1).max(9).nullable(),
    seats: z.number().int().min(1).max(60).nullable(),
    ownersCount: z.number().int().min(0).max(50).nullable(),
    huUntil: z.string().regex(/^\d{4}-\d{2}$/, 'Format JJJJ-MM').nullable(),
    origin: optionalText(80),
    emissionClass: z.enum(EMISSION_CLASSES).nullable(),
    holderType: z.enum(HOLDER_TYPES).nullable(),
    keysCount: z.number().int().min(0).max(20).nullable(),
    equipment: z.array(trimmed(80)).max(200),
    modelYear: year.nullable(),
  })
  .partial();
export type VehicleDataInput = z.infer<typeof vehicleDataSchema>;

export const vinInputSchema = z.object({ vin: z.string().trim().min(11).max(25), confirmDuplicate: z.boolean().optional() });
export const mileageInputSchema = z.object({ mileageKm: z.number().int().min(0).max(2_000_000) });

export const damageSchema = z.object({
  /** Client-ID (UUID) für idempotente Wiederholung aus der Offline-Warteschlange. */
  clientId: uuidSchema.optional(),
  zone: z.enum(DAMAGE_ZONES),
  kind: z.enum(DAMAGE_KINDS),
  size: optionalText(60),
  severity: z.enum(DAMAGE_SEVERITIES),
  description: optionalText(1000),
  photoIds: z.array(uuidSchema).max(20).default([]),
});

export const paintSchema = z.object({
  measurements: z
    .array(z.object({ point: z.enum(PAINT_POINTS), valueUm: z.number().int().min(0).max(5000) }))
    .max(PAINT_POINTS.length),
});

export const tiresSchema = z.object({
  tires: z
    .array(
      z.object({
        position: z.enum(TIRE_POSITIONS),
        brand: optionalText(60),
        dimension: optionalText(40),
        season: z.enum(TIRE_SEASONS).nullable(),
        treadMm: z.number().min(0).max(20).nullable(),
        damage: optionalText(300),
        dot: optionalText(10),
        rimCondition: optionalText(300),
      }),
    )
    .max(4),
});

export const pdrSchema = z.object({
  performed: z.boolean(),
  lineboardPhotoId: uuidSchema.nullable().optional(),
  dentCount: z.number().int().min(0).max(1000).nullable().optional(),
  positions: optionalText(500),
  size: optionalText(100),
  paintDamaged: z.boolean().nullable().optional(),
});

export const diagnosticSchema = z.object({
  clientId: uuidSchema.optional(),
  device: required(120),
  performedAt: isoDateTime,
  ecus: z.array(trimmed(120)).max(200).default([]),
  notes: optionalText(2000),
  codes: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(20),
        description: optionalText(500),
        status: z.enum(DTC_STATUSES),
      }),
    )
    .max(300),
});

export const batterySchema = z.object({
  kind: z.enum(BATTERY_KINDS),
  voltage: z.number().min(0).max(1000).nullable().optional(),
  testResult: optionalText(200),
  coldCranking: z.number().int().min(0).max(5000).nullable().optional(),
  hvInfo: z
    .object({
      sohPercent: z.number().min(0).max(100).nullable().optional(),
      capacityKwh: z.number().min(0).max(500).nullable().optional(),
      notes: optionalText(500),
    })
    .nullable()
    .optional(),
  hvSource: optionalText(200),
});

export const featuresSchema = z.object({
  features: z
    .array(z.object({ feature: z.enum(FEATURES), result: z.enum(FEATURE_RESULTS), note: optionalText(300) }))
    .max(FEATURES.length),
});

export const reviewVehicleSchema = z.object({
  action: z.enum(['approve', 'return']),
  reason: optionalText(2000),
  requestedPhotoSlots: z.array(z.string()).max(40).optional(),
});

export const correctionSchema = z.object({
  reason: required(1000),
  changes: vehicleDataSchema,
});

export const commentSchema = z.object({ text: required(4000) });

// ---------- Kataloge / Gruppen / Auktionen ----------
export const dealerGroupSchema = z.object({ name: required(120), description: optionalText(1000) });
export const dealerGroupMembersSchema = z.object({ companyIds: z.array(uuidSchema).max(1000) });

export const catalogSchema = z.object({
  name: required(200),
  description: optionalText(4000),
  startsAt: isoDateTime.nullable().optional(),
  endsAt: isoDateTime.nullable().optional(),
  dealerGroupId: uuidSchema.nullable().optional(),
});
export const catalogVehiclesSchema = z.object({ vehicleIds: z.array(uuidSchema).max(500) });

export const auctionParamsSchema = z.object({
  vehicleId: uuidSchema,
  catalogId: uuidSchema.nullable().optional(),
  startsAt: isoDateTime,
  durationMinutes: z.number().int().min(5).max(60 * 24 * 14),
  startPrice: cents.min(100),
  reservePrice: cents.nullable(),
  reserveVisible: z.boolean().default(false),
  bidIncrement: cents.min(100),
  buyNowPrice: cents.nullable().optional(),
  dealerGroupId: uuidSchema.nullable().optional(),
  buyerFeePctBp: z.number().int().min(0).max(5000).optional(),
  buyerFeeFixed: cents.optional(),
  sellerFeePctBp: z.number().int().min(0).max(5000).optional(),
  sellerFeeFixed: cents.optional(),
  taxType: z.enum(TAX_TYPES),
  locationStreet: optionalText(160),
  locationZip: zipSchema.optional().nullable(),
  locationCity: optionalText(100),
  earliestPickup: dateString.nullable().optional(),
  antiSnipeMinutes: z
    .number()
    .int()
    .refine((v) => (ANTI_SNIPE_OPTIONS as readonly number[]).includes(v), 'Ungültige Verlängerung'),
});
export type AuctionParamsInput = z.infer<typeof auctionParamsSchema>;
export const auctionUpdateSchema = auctionParamsSchema.omit({ vehicleId: true }).partial();
export const extendAuctionSchema = z.object({ endsAt: isoDateTime, reason: required(500) });

export const placeBidSchema = z.object({
  amount: cents.min(1),
  clientRequestId: z.string().min(8).max(64),
  confirmBinding: z.literal(true, { errorMap: () => ({ message: 'Verbindlichkeit muss bestätigt werden' }) }),
});
export const maxBidSchema = z.object({
  maxAmount: cents.min(1),
  clientRequestId: z.string().min(8).max(64),
  confirmBinding: z.literal(true, { errorMap: () => ({ message: 'Verbindlichkeit muss bestätigt werden' }) }),
});
export const buyNowSchema = z.object({
  clientRequestId: z.string().min(8).max(64),
  confirmBinding: z.literal(true, { errorMap: () => ({ message: 'Verbindlichkeit muss bestätigt werden' }) }),
});

export const auctionListQuerySchema = z.object({
  q: trimmed(100).optional(),
  make: trimmed(60).optional(),
  model: trimmed(80).optional(),
  regFrom: z.coerce.number().int().optional(),
  regTo: z.coerce.number().int().optional(),
  kmFrom: z.coerce.number().int().optional(),
  kmTo: z.coerce.number().int().optional(),
  fuel: z.enum(FUEL_TYPES).optional(),
  transmission: z.enum(TRANSMISSIONS).optional(),
  body: z.enum(BODY_TYPES).optional(),
  powerFrom: z.coerce.number().int().optional(),
  powerTo: z.coerce.number().int().optional(),
  priceFrom: z.coerce.number().int().optional(),
  priceTo: z.coerce.number().int().optional(),
  zip: z.string().regex(/^[0-9]{1,5}$/).optional(),
  city: trimmed(100).optional(),
  radiusKm: z.coerce.number().int().min(1).max(1000).optional(),
  damaged: z.enum(['yes', 'no']).optional(),
  paintFlagged: z.enum(['yes', 'no']).optional(),
  endingWithinHours: z.coerce.number().int().min(1).max(168).optional(),
  newWithinHours: z.coerce.number().int().min(1).max(168).optional(),
  favorites: z.enum(['1']).optional(),
  catalogId: uuidSchema.optional(),
  status: z.enum(['active', 'scheduled', 'ended']).optional(),
  sort: z.enum(['ending', 'newest', 'price_asc', 'price_desc']).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});
export type AuctionListQuery = z.infer<typeof auctionListQuerySchema>;

// ---------- Deals ----------
export const dealStatusSchema = z.object({ status: z.enum(DEAL_STATUSES), note: optionalText(1000) });
export const pickupInfoSchema = z.object({
  locationStreet: required(160),
  locationZip: zipSchema,
  locationCity: required(100),
  contactName: required(120),
  contactPhone: phoneSchema,
  openingHours: required(300),
});
export const pickupScheduleSchema = z.object({ scheduledAt: isoDateTime });
export const pickupConfirmSchema = z.object({ pickupCode: z.string().trim().min(4).max(20).optional() });
export const complaintSchema = z.object({ reason: required(200), description: required(4000) });
export const resolveComplaintSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES),
  resolution: optionalText(4000),
  dealStatus: z.enum(DEAL_STATUSES).optional(),
});
export const regenerateDocsSchema = z.object({ reason: required(500) });

export const settingsSchema = z.object({
  buyerFeePctBp: z.number().int().min(0).max(5000),
  buyerFeeFixed: cents,
  sellerFeePctBp: z.number().int().min(0).max(5000),
  sellerFeeFixed: cents,
  vatRateBp: z.number().int().min(0).max(5000),
  defaultAntiSnipeMinutes: z.number().int(),
  paymentDueDays: z.number().int().min(1).max(60),
  paintFlagBelowUm: z.number().int().min(0).max(1000),
  paintFlagAboveUm: z.number().int().min(0).max(5000),
  paymentInstructions: z.string().max(2000),
  platformName: z.string().min(1).max(120),
  platformAddress: z.string().max(500),
  /** Kontakt für Fragen von Händlern zu Fahrzeugen; leer = kein Kontaktblock auf der Auktionsseite. */
  supportEmail: z.union([z.literal(''), z.string().trim().email('Ungültige E-Mail-Adresse')]),
  supportPhone: z.string().trim().max(40),
  endingSoonMinutes: z.number().int().min(1).max(240),
  /** PDF-Branding des Plattformbetreibers (optional). */
  platformLogoKey: z.string().max(300),
  bankName: z.string().max(120),
  iban: z.string().trim().max(40),
  bic: z.string().trim().max(20),
  /** Hinweistext des Betreibers unter jeder Auktion (z. B. zu Gebrauchsspuren, Dokumentenversand); leer = kein Abschnitt. Kein Rechtstext (§61). */
  auctionNotice: z.string().max(2000),
});
export type PlatformSettings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: PlatformSettings = {
  buyerFeePctBp: 0,
  buyerFeeFixed: 19900,
  sellerFeePctBp: 0,
  sellerFeeFixed: 9900,
  vatRateBp: 1900,
  defaultAntiSnipeMinutes: 2,
  paymentDueDays: 5,
  paintFlagBelowUm: 70,
  paintFlagAboveUm: 200,
  paymentInstructions:
    '[VORLAGE – vor Livegang durch Betreiber zu ersetzen] Bitte überweisen Sie den Gesamtbetrag unter Angabe der Deal-ID auf das Konto des Plattformbetreibers.',
  platformName: 'Schnell-Deal B2B Fahrzeugauktionen',
  platformAddress: '[VORLAGE – Anschrift des Plattformbetreibers]',
  supportEmail: '',
  supportPhone: '',
  endingSoonMinutes: 15,
  platformLogoKey: '',
  bankName: '',
  iban: '',
  bic: '',
  auctionNotice: '',
};
