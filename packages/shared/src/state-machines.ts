import type {
  AuctionStatus,
  BiddingStatus,
  CompanyStatus,
  DealStatus,
  InspectionStatus,
  VehicleStatus,
} from './enums';

type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export const COMPANY_TRANSITIONS: Machine<CompanyStatus> = {
  REGISTRATION_STARTED: ['DOCUMENTS_MISSING', 'IN_REVIEW', 'REJECTED'],
  DOCUMENTS_MISSING: ['IN_REVIEW', 'REJECTED'],
  IN_REVIEW: ['APPROVED', 'REJECTED', 'DOCUMENTS_MISSING'],
  APPROVED: ['BLOCKED'],
  REJECTED: ['IN_REVIEW'],
  BLOCKED: ['APPROVED'],
};

export const BIDDING_TRANSITIONS: Machine<BiddingStatus> = {
  VIEW_ONLY: ['CAN_BID', 'BLOCKED'],
  CAN_BID: ['VIEW_ONLY', 'TEMP_BLOCKED', 'BLOCKED'],
  TEMP_BLOCKED: ['CAN_BID', 'VIEW_ONLY', 'BLOCKED'],
  BLOCKED: ['VIEW_ONLY', 'CAN_BID'],
};

export const INSPECTION_TRANSITIONS: Machine<InspectionStatus> = {
  NEW: ['PLANNED', 'ASSIGNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'CANCELLED', 'NEW'],
  ASSIGNED: ['PLANNED', 'EN_ROUTE', 'ON_SITE', 'CANCELLED'],
  EN_ROUTE: ['ON_SITE', 'ASSIGNED', 'CANCELLED'],
  ON_SITE: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export const VEHICLE_TRANSITIONS: Machine<VehicleStatus> = {
  DRAFT: ['INSPECTION_IN_PROGRESS'],
  INSPECTION_IN_PROGRESS: ['WAITING_REVIEW'],
  WAITING_REVIEW: ['APPROVED', 'REQUIRES_CORRECTION'],
  REQUIRES_CORRECTION: ['WAITING_REVIEW'],
  APPROVED: ['SCHEDULED', 'REQUIRES_CORRECTION'],
  SCHEDULED: ['APPROVED', 'IN_AUCTION'],
  // APPROVED: Abbruch einer laufenden Auktion ohne Zuschlag (Fahrzeug kann erneut eingestellt werden).
  IN_AUCTION: ['SOLD', 'UNSOLD', 'APPROVED'],
  SOLD: ['COMPLETED', 'UNSOLD'],
  UNSOLD: ['SCHEDULED', 'SOLD', 'COMPLETED', 'APPROVED'],
  COMPLETED: [],
};

export const AUCTION_TRANSITIONS: Machine<AuctionStatus> = {
  DRAFT: ['SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['DRAFT', 'ACTIVE', 'CANCELLED'],
  ACTIVE: ['ENDED', 'CANCELLED'],
  ENDED: [],
  CANCELLED: [],
};

export const DEAL_TRANSITIONS: Machine<DealStatus> = {
  CREATED: ['PAYMENT_PENDING', 'DISPUTED', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'DISPUTED', 'CANCELLED'],
  PAID: ['READY_FOR_PICKUP', 'DISPUTED', 'CANCELLED'],
  READY_FOR_PICKUP: ['PICKUP_SCHEDULED', 'PICKED_UP', 'DISPUTED'],
  PICKUP_SCHEDULED: ['PICKED_UP', 'READY_FOR_PICKUP', 'DISPUTED'],
  PICKED_UP: ['COMPLETED', 'DISPUTED'],
  COMPLETED: [],
  // Aus DISPUTED kann der Admin in jeden aktiven Status zurück oder stornieren.
  DISPUTED: [
    'PAYMENT_PENDING',
    'PAID',
    'READY_FOR_PICKUP',
    'PICKUP_SCHEDULED',
    'PICKED_UP',
    'COMPLETED',
    'CANCELLED',
  ],
  CANCELLED: [],
};

export const MACHINES = {
  company: COMPANY_TRANSITIONS,
  bidding: BIDDING_TRANSITIONS,
  inspection: INSPECTION_TRANSITIONS,
  vehicle: VEHICLE_TRANSITIONS,
  auction: AUCTION_TRANSITIONS,
  deal: DEAL_TRANSITIONS,
} as const;

export type MachineName = keyof typeof MACHINES;

export function canTransition<M extends MachineName>(machine: M, from: string, to: string): boolean {
  const table = MACHINES[machine] as Record<string, readonly string[]>;
  return (table[from] ?? []).includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly machine: MachineName,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Ungültiger Statuswechsel (${machine}): ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition<M extends MachineName>(machine: M, from: string, to: string): void {
  if (!canTransition(machine, from, to)) throw new InvalidTransitionError(machine, from, to);
}
