import type {
  AuctionOutcome,
  AuctionStatus,
  BatteryKind,
  BodyType,
  DamageKind,
  DamageSeverity,
  DamageZone,
  DealStatus,
  DriveType,
  DtcStatus,
  EmissionClass,
  Feature,
  FeatureResult,
  FuelType,
  HolderType,
  InspectionStatus,
  PaintPoint,
  PhotoQuality,
  PhotoSlot,
  TaxType,
  TirePosition,
  TireSeason,
  Transmission,
  VehicleDocumentKind,
  VehicleStatus,
  VinCheck,
} from '@sd/shared';

export interface VehicleFile {
  id: string;
  internalNumber: string;
  status: VehicleStatus;
  vin: string | null;
  vinCheck: VinCheck;
  licensePlate?: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  firstRegistration: string | null;
  modelYear: number | null;
  mileageKm: number | null;
  fuel: FuelType | null;
  powerKw: number | null;
  powerPs: number | null;
  displacementCcm: number | null;
  transmission: Transmission | null;
  drive: DriveType | null;
  body: BodyType | null;
  color: string | null;
  doors: number | null;
  seats: number | null;
  ownersCount: number | null;
  huUntil: string | null;
  origin: string | null;
  emissionClass: EmissionClass | null;
  holderType: HolderType | null;
  keysCount: number | null;
  equipment: string[];
  completenessPct: number;
  hasDamages: boolean;
  paintFlagged: boolean;
  location: { zip: string | null; city: string | null; street?: string | null };
  seller?: { id: string; name: string; city: string; zip: string };
  inspectorName?: string | null;
  inspectionRequestId?: string | null;
  inspectionStartedAt: string | null;
  inspectionCompletedAt: string | null;
  lockedAt: string | null;
  reviewNote?: string | null;
  requestedPhotoSlots?: string[];
  returnCount?: number;
  approvedAt: string | null;
  photos: { id: string; slot: PhotoSlot; quality: PhotoQuality; qualityOverride: boolean; width: number | null; height: number | null; processed: boolean; replaced: boolean; replacedAt: string | null; createdAt: string; qualityMetrics?: Record<string, number> }[];
  damages: { id: string; zone: DamageZone; kind: DamageKind; size: string | null; severity: DamageSeverity; description: string | null; photoIds: string[] }[];
  documents: { id: string; kind: VehicleDocumentKind; fileName: string; mime: string; sizeBytes: number; visibleToBuyers?: boolean; releasedAt?: string | null; createdAt: string }[];
  paint: { point: PaintPoint; valueUm: number; flagged: boolean }[];
  tires: { position: TirePosition; brand: string | null; dimension: string | null; season: TireSeason | null; treadMm: number | null; damage: string | null; dot: string | null; rimCondition: string | null }[];
  pdr: { performed: boolean; lineboardPhotoId: string | null; dentCount: number | null; positions: string | null; size: string | null; paintDamaged: boolean | null } | null;
  diagnostics: { id: string; device: string; performedAt: string; ecus: string[]; notes: string | null; codes: { code: string; description: string | null; status: DtcStatus }[] }[];
  battery: { kind: BatteryKind; voltage: number | null; testResult: string | null; coldCranking: number | null; hvInfo: { sohPercent?: number | null; capacityKwh?: number | null; notes?: string | null } | null; hvSource: string | null } | null;
  features: { feature: Feature; result: FeatureResult; note: string | null }[];
  comments?: { id: string; text: string; createdAt: string; author: string }[];
  revisions?: { id: string; field: string; oldValue: unknown; newValue: unknown; reason: string; createdAt: string }[];
  completeness?: { percent: number; missing: string[]; missingPhotoSlots: PhotoSlot[]; canComplete: boolean; photoStats: { required: number; present: number; badQuality: number } };
  createdAt: string;
}

export interface DealerAuctionState {
  auctionId: string;
  number: string;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  startPrice: number;
  bidIncrement: number;
  currentBid: number | null;
  bidCount: number;
  bidderCount: number;
  minNextBid: number;
  leaderLabel: number | null;
  reserveVisible: boolean;
  reservePrice?: number | null;
  reserveMet?: boolean;
  buyNowPrice: number | null;
  antiSnipeMinutes: number;
  extensionCount: number;
  taxType: TaxType;
  buyerFeePctBp: number;
  buyerFeeFixed: number;
  earliestPickup: string | null;
  location: { zip: string | null; city: string | null };
  version: number;
  me: { label: number | null; status: 'NONE' | 'LEADING' | 'OUTBID' | 'WON' | 'LOST' | 'RESERVE_NOT_MET'; maxBid: number | null; maxBidExhausted: boolean; highestBid: number | null };
}

export interface SellerAuctionState {
  auctionId: string;
  number: string;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  serverNow: string;
  startPrice: number;
  reservePrice: number | null;
  reserveMet: boolean;
  currentBid: number | null;
  bidCount: number;
  bidderCount: number;
  outcome: AuctionOutcome | null;
  endedAt: string | null;
  version: number;
}

export interface AuctionCard {
  id: string;
  number: string;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  startPrice: number;
  currentBid: number | null;
  bidCount: number;
  outcome: AuctionOutcome | null;
  vehicleId: string;
  make: string | null;
  model: string | null;
  variant: string | null;
  firstRegistration: string | null;
  mileageKm: number | null;
  powerKw: number | null;
  fuel: FuelType | null;
  transmission: Transmission | null;
  hasDamages: boolean;
  paintFlagged: boolean;
  locationZip: string | null;
  locationCity: string | null;
  mainPhotoId: string | null;
  isFavorite: boolean;
  myBid: number | null;
  myStatus: 'LEADING' | 'OUTBID' | null;
  reservePrice?: number | null;
}

export interface InspectionRequestItem {
  id: string;
  number: string;
  status: InspectionStatus;
  company: { id: string; name: string };
  vehicleCount: number;
  vehiclesRecorded: number;
  vehiclesWaitingReview: number;
  location: { street: string; zip: string; city: string };
  lat: number | null;
  lng: number | null;
  requestedDate: string;
  earliestTime: string;
  latestTime: string;
  contactName: string;
  contactPhone: string;
  notes: string | null;
  vehiclesDrivable: boolean;
  keysAvailable: boolean;
  papersAvailable: boolean;
  scheduledAt: string | null;
  cancelledReason: string | null;
  assignment: {
    inspectorUserId?: string;
    inspectorName: string;
    inspectorPhone?: string | null;
    scheduledAt: string;
    enRouteAt: string | null;
    arrivedAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
  } | null;
  statusText: string;
  createdAt: string;
  vehicles?: { id: string; internalNumber: string; vin: string | null; make: string | null; model: string | null; status: VehicleStatus; completenessPct: number; createdAt: string }[];
}

export interface DealView {
  id: string;
  dealNumber: string;
  auctionId: string;
  vehicleId: string;
  status: DealStatus;
  salePrice: number;
  vehicleVat: number;
  vatRateBp: number;
  taxType: TaxType;
  vin: string | null;
  vehicle: { internalNumber: string; make: string | null; model: string | null; variant: string | null; firstRegistration: string | null; mileageKm: number | null; licensePlate?: string | null };
  soldAt: string;
  auctionEndedAt: string;
  paymentDueAt: string | null;
  paidAt: string | null;
  completedAt: string | null;
  cancelledReason: string | null;
  origin?: string;
  seller?: { name: string; legalForm: string; street: string; houseNumber: string; zip: string; city: string; contact: string; phone: string; email: string };
  buyer?: { name: string; legalForm: string; street: string; houseNumber: string; zip: string; city: string; contact: string; phone: string; email: string };
  buyerFeeNet?: number;
  buyerFeeVat?: number;
  buyerTotal?: number;
  sellerFeeNet?: number;
  sellerFeeVat?: number;
  sellerPayout?: number;
}

/** Katalog-Kontext einer Auktion aus Händlersicht (nur für diesen Händler sichtbare Auktionen). */
export interface AuctionCatalogContext {
  id: string;
  name: string;
  startsAt: string | null;
  position: number | null;
  total: number;
  prevAuctionId: string | null;
  nextAuctionId: string | null;
}

export interface DealerAuctionDetail {
  state: DealerAuctionState;
  vehicle: VehicleFile;
  isFavorite: boolean;
  catalog: AuctionCatalogContext | null;
  contact: { name: string; email: string | null; phone: string | null };
}
