/**
 * Reine Gebotslogik (ohne I/O). Der Server ruft diese Funktionen INNERHALB einer
 * Datenbanktransaktion mit Row-Lock auf der Auktion auf. Dadurch ist die
 * Reihenfolge serverseitig eindeutig; diese Funktion entscheidet nur, welche
 * Gebotsdatensätze aus einem eingehenden Gebot entstehen.
 */

export interface AuctionPriceState {
  startPrice: number; // Cent
  increment: number; // Cent
  currentBid: number | null;
  leaderId: string | null; // Händler-Firma, die aktuell führt
  /** Aktives Maximalgebot des Führenden (nur serverseitig bekannt). */
  leaderMax: number | null;
}

export function minNextBid(state: Pick<AuctionPriceState, 'startPrice' | 'increment' | 'currentBid'>): number {
  return state.currentBid === null ? state.startPrice : state.currentBid + state.increment;
}

export interface IncomingBid {
  bidderId: string;
  /** Explizit gebotener Betrag. Bei reinem Bietagent = minNextBid. */
  amount: number;
  /** Optionales Maximalgebot des Bieters (>= amount). */
  maxAmount: number | null;
  /** true, wenn der Bieter nur ein Maximalgebot gesetzt hat (kein manuelles Gebot). */
  proxyOnly?: boolean;
}

export interface ResultingBidRecord {
  bidderId: string;
  amount: number;
  kind: 'MANUAL' | 'PROXY';
}

export type BidResolution =
  | {
      ok: true;
      /** In dieser Reihenfolge zu speichern; der letzte Datensatz ist WINNING. */
      records: ResultingBidRecord[];
      newCurrentBid: number;
      newLeaderId: string;
      /** Ob sich der Führende geändert hat (für "überboten"-Benachrichtigung). */
      leaderChanged: boolean;
      previousLeaderId: string | null;
      /** true, wenn das Gebot des eingehenden Bieters sofort durch einen Bietagent übertroffen wurde. */
      outbidByProxy: boolean;
    }
  | { ok: false; code: 'BID_TOO_LOW' | 'ALREADY_LEADING' | 'MAX_BELOW_AMOUNT' | 'INVALID_AMOUNT'; minNextBid: number };

export function resolveBid(state: AuctionPriceState, bid: IncomingBid): BidResolution {
  const min = minNextBid(state);
  if (!Number.isSafeInteger(bid.amount) || bid.amount <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', minNextBid: min };
  }
  if (bid.maxAmount !== null && (!Number.isSafeInteger(bid.maxAmount) || bid.maxAmount < bid.amount)) {
    return { ok: false, code: 'MAX_BELOW_AMOUNT', minNextBid: min };
  }
  if (state.leaderId !== null && state.leaderId === bid.bidderId) {
    return { ok: false, code: 'ALREADY_LEADING', minNextBid: min };
  }
  if (bid.amount < min) {
    return { ok: false, code: 'BID_TOO_LOW', minNextBid: min };
  }

  const firstKind: ResultingBidRecord['kind'] = bid.proxyOnly ? 'PROXY' : 'MANUAL';
  const challengerMax = Math.max(bid.amount, bid.maxAmount ?? 0);

  // Kein bisheriges Gebot: Bieter führt mit seinem Betrag.
  if (state.leaderId === null || state.currentBid === null) {
    return {
      ok: true,
      records: [{ bidderId: bid.bidderId, amount: bid.amount, kind: firstKind }],
      newCurrentBid: bid.amount,
      newLeaderId: bid.bidderId,
      leaderChanged: true,
      previousLeaderId: null,
      outbidByProxy: false,
    };
  }

  const leaderMax = Math.max(state.currentBid, state.leaderMax ?? 0);
  const records: ResultingBidRecord[] = [{ bidderId: bid.bidderId, amount: bid.amount, kind: firstKind }];

  if (challengerMax > leaderMax) {
    // Herausforderer gewinnt. Der Bietagent des bisherigen Führenden wird bis zu seinem Maximum ausgeschöpft.
    if (leaderMax > state.currentBid) {
      records.push({ bidderId: state.leaderId, amount: leaderMax, kind: 'PROXY' });
    }
    const price = Math.max(bid.amount, Math.min(challengerMax, leaderMax + state.increment));
    if (price > bid.amount) {
      records.push({ bidderId: bid.bidderId, amount: price, kind: 'PROXY' });
    }
    sortRecords(records, bid.bidderId);
    return {
      ok: true,
      records,
      newCurrentBid: price,
      newLeaderId: bid.bidderId,
      leaderChanged: true,
      previousLeaderId: state.leaderId,
      outbidByProxy: false,
    };
  }

  // Bisheriger Führender verteidigt per Bietagent (bei Gleichstand gewinnt das frühere Maximalgebot).
  if (challengerMax > bid.amount) {
    records.push({ bidderId: bid.bidderId, amount: challengerMax, kind: 'PROXY' });
  }
  const leaderPrice = Math.min(leaderMax, challengerMax + state.increment);
  records.push({ bidderId: state.leaderId, amount: leaderPrice, kind: 'PROXY' });
  return {
    ok: true,
    records,
    newCurrentBid: leaderPrice,
    newLeaderId: state.leaderId,
    leaderChanged: false,
    previousLeaderId: state.leaderId,
    outbidByProxy: true,
  };
}

/**
 * Stabil nach Betrag sortieren. Im Gewinnfall des Herausforderers ist dessen
 * Preis strikt größer als das ausgeschöpfte Maximum des bisherigen Führenden,
 * daher steht der Gewinner-Datensatz nach der Sortierung am Ende. Bei gleichem
 * Betrag gewinnt der Gewinner-Datensatz (wird ans Ende geschoben).
 */
function sortRecords(records: ResultingBidRecord[], winnerId: string): void {
  records.sort((a, b) => a.amount - b.amount || (a.bidderId === winnerId ? 1 : 0) - (b.bidderId === winnerId ? 1 : 0));
}

/** Anti-Sniping: neue Endzeit berechnen (Spec §28: "um X Minuten verlängern"). */
export function applyAntiSniping(endsAt: Date, now: Date, minutes: number): { endsAt: Date; extended: boolean } {
  if (minutes <= 0) return { endsAt, extended: false };
  const windowMs = minutes * 60_000;
  if (endsAt.getTime() - now.getTime() <= windowMs) {
    return { endsAt: new Date(endsAt.getTime() + windowMs), extended: true };
  }
  return { endsAt, extended: false };
}

export type EndOutcome = 'SOLD' | 'RESERVE_NOT_MET' | 'NO_BIDS';

export function determineOutcome(params: { bidCount: number; currentBid: number | null; reservePrice: number | null }): EndOutcome {
  if (params.bidCount === 0 || params.currentBid === null) return 'NO_BIDS';
  if (params.reservePrice !== null && params.currentBid < params.reservePrice) return 'RESERVE_NOT_MET';
  return 'SOLD';
}
