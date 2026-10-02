import { describe, expect, it } from 'vitest';
import { applyAntiSniping, determineOutcome, minNextBid, resolveBid, type AuctionPriceState } from '../bidding';

const base: AuctionPriceState = { startPrice: 1_000_000, increment: 10_000, currentBid: null, leaderId: null, leaderMax: null };

describe('minNextBid', () => {
  it('ist der Startpreis ohne Gebote', () => {
    expect(minNextBid(base)).toBe(1_000_000);
  });
  it('ist aktuelles Gebot + Schritt', () => {
    expect(minNextBid({ ...base, currentBid: 1_000_000 })).toBe(1_010_000);
  });
});

describe('resolveBid', () => {
  it('erstes Gebot führt', () => {
    const r = resolveBid(base, { bidderId: 'A', amount: 1_000_000, maxAmount: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newLeaderId).toBe('A');
    expect(r.newCurrentBid).toBe(1_000_000);
    expect(r.records).toEqual([{ bidderId: 'A', amount: 1_000_000, kind: 'MANUAL' }]);
  });

  it('lehnt zu niedrige Gebote ab und nennt das Mindestgebot', () => {
    const r = resolveBid({ ...base, currentBid: 1_000_000, leaderId: 'A' }, { bidderId: 'B', amount: 1_005_000, maxAmount: null });
    expect(r).toEqual({ ok: false, code: 'BID_TOO_LOW', minNextBid: 1_010_000 });
  });

  it('verhindert, dass der Führende sich selbst überbietet', () => {
    const r = resolveBid({ ...base, currentBid: 1_000_000, leaderId: 'A' }, { bidderId: 'A', amount: 1_100_000, maxAmount: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('ALREADY_LEADING');
  });

  it('Spec-Beispiel: aktuelles Gebot 10.000 €, A hat Maximalgebot 12.000 €, B bietet 10.100 € → A führt mit 10.200 €', () => {
    const state: AuctionPriceState = { ...base, currentBid: 1_000_000, leaderId: 'A', leaderMax: 1_200_000 };
    const r = resolveBid(state, { bidderId: 'B', amount: 1_010_000, maxAmount: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newLeaderId).toBe('A');
    expect(r.newCurrentBid).toBe(1_020_000);
    expect(r.outbidByProxy).toBe(true);
    expect(r.records.map((x) => [x.bidderId, x.amount, x.kind])).toEqual([
      ['B', 1_010_000, 'MANUAL'],
      ['A', 1_020_000, 'PROXY'],
    ]);
  });

  it('Herausforderer überbietet das Maximalgebot des Führenden', () => {
    const state: AuctionPriceState = { ...base, currentBid: 1_000_000, leaderId: 'A', leaderMax: 1_200_000 };
    const r = resolveBid(state, { bidderId: 'B', amount: 1_250_000, maxAmount: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newLeaderId).toBe('B');
    expect(r.newCurrentBid).toBe(1_250_000);
    expect(r.records.map((x) => [x.bidderId, x.amount])).toEqual([
      ['A', 1_200_000],
      ['B', 1_250_000],
    ]);
    expect(r.records.at(-1)!.bidderId).toBe('B');
  });

  it('zwei Bietagenten: höheres Maximum gewinnt mit einem Schritt über dem unterlegenen Maximum', () => {
    const state: AuctionPriceState = { ...base, currentBid: 1_000_000, leaderId: 'A', leaderMax: 1_200_000 };
    const r = resolveBid(state, { bidderId: 'B', amount: 1_010_000, maxAmount: 1_500_000, proxyOnly: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newLeaderId).toBe('B');
    expect(r.newCurrentBid).toBe(1_210_000);
    expect(r.records.at(-1)).toEqual({ bidderId: 'B', amount: 1_210_000, kind: 'PROXY' });
  });

  it('Gleichstand der Maxima: das frühere Maximalgebot gewinnt', () => {
    const state: AuctionPriceState = { ...base, currentBid: 1_000_000, leaderId: 'A', leaderMax: 1_200_000 };
    const r = resolveBid(state, { bidderId: 'B', amount: 1_010_000, maxAmount: 1_200_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newLeaderId).toBe('A');
    expect(r.newCurrentBid).toBe(1_200_000);
  });

  it('Gewinnerpreis übersteigt nie das Maximalgebot des Gewinners', () => {
    const state: AuctionPriceState = { ...base, currentBid: 1_000_000, leaderId: 'A', leaderMax: 1_195_000 };
    const r = resolveBid(state, { bidderId: 'B', amount: 1_010_000, maxAmount: 1_200_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.newCurrentBid).toBe(1_200_000);
  });

  it('Datensätze sind aufsteigend und der letzte gehört dem Führenden', () => {
    for (let i = 0; i < 500; i++) {
      const current = 1_000_000 + Math.floor(Math.random() * 50) * 10_000;
      const leaderMax = Math.random() < 0.5 ? null : current + Math.floor(Math.random() * 40) * 5_000;
      const state: AuctionPriceState = { ...base, currentBid: current, leaderId: 'A', leaderMax };
      const amount = current + 10_000 + Math.floor(Math.random() * 20) * 5_000;
      const max = Math.random() < 0.5 ? null : amount + Math.floor(Math.random() * 40) * 5_000;
      const r = resolveBid(state, { bidderId: 'B', amount, maxAmount: max });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const amounts = r.records.map((x) => x.amount);
      expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
      expect(r.records.at(-1)!.bidderId).toBe(r.newLeaderId);
      expect(r.records.at(-1)!.amount).toBe(r.newCurrentBid);
      expect(r.newCurrentBid).toBeGreaterThan(current);
    }
  });
});

describe('applyAntiSniping', () => {
  const end = new Date('2026-10-05T12:00:00Z');
  it('verlängert innerhalb des Fensters um X Minuten', () => {
    const r = applyAntiSniping(end, new Date('2026-10-05T11:59:00Z'), 2);
    expect(r.extended).toBe(true);
    expect(r.endsAt.toISOString()).toBe('2026-10-05T12:02:00.000Z');
  });
  it('verlängert nicht außerhalb des Fensters', () => {
    expect(applyAntiSniping(end, new Date('2026-10-05T11:50:00Z'), 2).extended).toBe(false);
  });
  it('ist abschaltbar', () => {
    expect(applyAntiSniping(end, new Date('2026-10-05T11:59:59Z'), 0).extended).toBe(false);
  });
});

describe('determineOutcome', () => {
  it('ohne Gebote', () => expect(determineOutcome({ bidCount: 0, currentBid: null, reservePrice: 100 })).toBe('NO_BIDS'));
  it('Reserve erreicht', () => expect(determineOutcome({ bidCount: 3, currentBid: 100, reservePrice: 100 })).toBe('SOLD'));
  it('Reserve nicht erreicht', () =>
    expect(determineOutcome({ bidCount: 3, currentBid: 99, reservePrice: 100 })).toBe('RESERVE_NOT_MET'));
  it('ohne Reserve', () => expect(determineOutcome({ bidCount: 1, currentBid: 1, reservePrice: null })).toBe('SOLD'));
});
