import crypto from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import WebSocket from 'ws';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';
import { db, schema } from '../../src/core/db/client';
import { hub } from '../../src/core/realtime';
import { AuctionScheduler } from '../../src/modules/auctions/scheduler';
import { createPlatformUser, approvedDealership, PASSWORD, type Session } from '../helpers';
import { activeAuction, fixtureApprovedVehicle } from '../flows';
import { fixtureDealer } from '../fixtures';

/**
 * Concurrency-Nachweise gegen einen ECHTEN HTTP-Server (parallele TCP-Verbindungen,
 * Connection-Pool, Row-Locks). Spezifikation §26/§27/§52.
 */

let app: FastifyInstance;
let base: string;
let admin: Session;
let seller: Session;
const dealers: { companyId: string; cookie: string }[] = [];
const ORIGIN = 'http://localhost:3000';

async function http(method: string, path: string, opts: { cookie?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    // Eine Anfrage ohne Antwort soll den Lauf mit klarer Meldung abbrechen, nicht bis zum Test-Timeout hängen.
    signal: AbortSignal.timeout(90_000),
    headers: {
      origin: ORIGIN,
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function loginHttp(email: string): Promise<string> {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return res.headers.getSetCookie().find((c) => c.startsWith('sd_session='))!.split(';')[0]!;
}

async function invariants(auctionId: string) {
  const [a] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, auctionId));
  const rows = await db.select().from(schema.bids).where(eq(schema.bids.auctionId, auctionId));
  rows.sort((x, y) => x.sequence - y.sequence);
  const winning = rows.filter((r) => r.status === 'WINNING');
  expect(winning).toHaveLength(rows.length ? 1 : 0);
  expect(rows.map((r) => r.sequence)).toEqual(rows.map((_, i) => i + 1));
  expect(a!.bidCount).toBe(rows.length);
  if (rows.length) {
    const max = Math.max(...rows.map((r) => r.amount));
    expect(a!.currentBid).toBe(max);
    expect(winning[0]!.amount).toBe(max);
    expect(winning[0]!.id).toBe(a!.winningBidId);
    expect(winning[0]!.companyId).toBe(a!.currentBidderCompanyId);
    // Beträge sind in Verarbeitungsreihenfolge nicht fallend.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.amount).toBeGreaterThanOrEqual(rows[i - 1]!.amount);
    // Serverzeiten sind monoton zur Sequenz.
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.serverTime.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.serverTime.getTime());
  }
  return { a: a!, rows };
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
  await hub.start();
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  admin = await createPlatformUser('ADMIN');
  seller = await approvedDealership(admin);
  const created = await Promise.all(Array.from({ length: 100 }, (_, i) => fixtureDealer(i)));
  for (const d of created) dealers.push({ companyId: d.companyId, cookie: await loginHttp(d.email) });
}, 180_000);

afterAll(async () => {
  await app.close();
  await hub.stop();
});

describe('Concurrency: Gebote', () => {
  it('100 gleichzeitige Gebote auf eine Auktion: keine verlorenen Gebote, genau ein Höchstbietender', async () => {
    const v = await fixtureApprovedVehicle(seller.companyId!);
    const id = await activeAuction(admin, v.id, { startPrice: 1_000_000, bidIncrement: 10_000, antiSnipeMinutes: 0 });
    // Alle Gebote gültig zum Startzeitpunkt, mit unterschiedlichen Beträgen.
    const amounts = crypto.randomBytes(100).reduce<number[]>((acc, _b, i) => (acc.push(1_000_000 + i * 10_000), acc), []);
    amounts.sort(() => Math.random() - 0.5);
    const requests = dealers.map((d, i) => ({ d, amount: amounts[i]!, clientRequestId: crypto.randomUUID() }));
    const results = await Promise.all(
      requests.map((r) => http('POST', `/auctions/${id}/bids`, { cookie: r.d.cookie, body: { amount: r.amount, clientRequestId: r.clientRequestId, confirmBinding: true } })),
    );
    const accepted = results.map((res, i) => ({ res, req: requests[i]! })).filter((x) => x.res.status === 201);
    const rejected = results.filter((r) => r.status !== 201);
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.length + rejected.length).toBe(100);
    // Abgelehnte Gebote nur aus fachlichen Gründen – keine Serverfehler.
    for (const r of rejected) {
      expect(r.status).toBe(409);
      expect(['BID_TOO_LOW', 'ALREADY_LEADING']).toContain(r.body.error.code);
    }
    const { a, rows } = await invariants(id);
    // Jedes angenommene Gebot ist gespeichert (keine verlorenen Gebote), abgelehnte nicht.
    const storedKeys = new Set(rows.map((r) => r.clientRequestId));
    for (const x of accepted) expect(storedKeys.has(x.req.clientRequestId)).toBe(true);
    expect(rows.length).toBe(accepted.length);
    // Das höchste angenommene Gebot führt.
    const top = accepted.reduce((m, x) => (x.req.amount > m.req.amount ? x : m));
    expect(a.currentBid).toBe(top.req.amount);
    expect(a.currentBidderCompanyId).toBe(top.req.d.companyId);
  });

  it('Spec-Beispiel parallel: A bietet 10.100 €, B bietet 10.200 € → in jeder Reihenfolge führt B mit 10.200 € (20 Wiederholungen)', async () => {
    for (let round = 0; round < 20; round++) {
      const v = await fixtureApprovedVehicle(seller.companyId!);
      const id = await activeAuction(admin, v.id, { startPrice: 1_000_000, bidIncrement: 10_000, antiSnipeMinutes: 0 });
      const opener = dealers[round % 50]!;
      const A = dealers[50 + (round % 25)]!;
      const B = dealers[75 + (round % 25)]!;
      expect((await http('POST', `/auctions/${id}/bids`, { cookie: opener.cookie, body: { amount: 1_000_000, clientRequestId: crypto.randomUUID(), confirmBinding: true } })).status).toBe(201);
      await Promise.all([
        http('POST', `/auctions/${id}/bids`, { cookie: A.cookie, body: { amount: 1_010_000, clientRequestId: crypto.randomUUID(), confirmBinding: true } }),
        http('POST', `/auctions/${id}/bids`, { cookie: B.cookie, body: { amount: 1_020_000, clientRequestId: crypto.randomUUID(), confirmBinding: true } }),
      ]);
      const { a } = await invariants(id);
      expect(a.currentBid).toBe(1_020_000);
      expect(a.currentBidderCompanyId).toBe(B.companyId);
    }
  });

  it('50 gleichzeitige Maximalgebote: höchstes Maximum gewinnt zum korrekten Preis, Maxima bleiben geheim', async () => {
    const v = await fixtureApprovedVehicle(seller.companyId!);
    const id = await activeAuction(admin, v.id, { startPrice: 1_000_000, bidIncrement: 10_000, antiSnipeMinutes: 0 });
    const bidders = dealers.slice(0, 50);
    const maxima = bidders.map((_, i) => 1_000_000 + (i + 1) * 37_000); // eindeutige Maxima
    maxima.sort(() => Math.random() - 0.5);
    const results = await Promise.all(
      bidders.map((d, i) => http('PUT', `/auctions/${id}/max-bid`, { cookie: d.cookie, body: { maxAmount: maxima[i]!, clientRequestId: crypto.randomUUID(), confirmBinding: true } })),
    );
    for (const r of results) {
      if (r.status !== 200) {
        // Ein Maximum unter dem dann gültigen Mindestgebot wird fachlich abgelehnt.
        expect(r.status).toBe(409);
        expect(['MAX_TOO_LOW', 'BID_TOO_LOW']).toContain(r.body.error.code);
      }
    }
    const { a } = await invariants(id);
    const sorted = [...maxima].sort((x, y) => y - x);
    const topIdx = maxima.indexOf(sorted[0]!);
    expect(a.currentBidderCompanyId).toBe(bidders[topIdx]!.companyId);
    // Preis: ein Schritt über dem zweithöchsten wirksamen Maximum, gedeckelt durch das höchste.
    const accepted = maxima.filter((_, i) => results[i]!.status === 200).sort((x, y) => y - x);
    expect(a.currentBid).toBe(Math.min(accepted[0]!, accepted[1]! + 10_000));
    // Kein Händler sieht ein fremdes Maximum.
    const view = await http('GET', `/auctions/${id}/bids`, { cookie: bidders[(topIdx + 1) % 50]!.cookie });
    expect(JSON.stringify(view.body)).not.toContain(String(sorted[0]));
  });
});

describe('Concurrency: Auktionsende', () => {
  it('Gebote zum Endzeitpunkt: kein Gebot nach Ende, genau ein Deal, Endzeit serverseitig korrekt', async () => {
    const v = await fixtureApprovedVehicle(seller.companyId!);
    const id = await activeAuction(admin, v.id, { startPrice: 1_000_000, bidIncrement: 10_000, antiSnipeMinutes: 0 });
    const endsAt = new Date(Date.now() + 1500);
    await db.update(schema.auctions).set({ endsAt }).where(eq(schema.auctions.id, id));
    const schedulers = [new AuctionScheduler(), new AuctionScheduler(), new AuctionScheduler()];
    let amount = 1_000_000;
    const bids: Promise<{ status: number }>[] = [];
    const sweeps: Promise<unknown>[] = [];
    const deadline = Date.now() + 3000;
    let i = 0;
    while (Date.now() < deadline) {
      const d = dealers[i % 100]!;
      bids.push(http('POST', `/auctions/${id}/bids`, { cookie: d.cookie, body: { amount: (amount += 10_000), clientRequestId: crypto.randomUUID(), confirmBinding: true } }));
      // Drei "Instanzen" ticken parallel (mehrinstanzfähiger Scheduler).
      sweeps.push(schedulers[i % 3]!.tick());
      i++;
      await new Promise((r) => setTimeout(r, 15));
    }
    const results = await Promise.all(bids);
    await Promise.all(sweeps);
    await schedulers[0]!.tick();
    const { a, rows } = await invariants(id);
    expect(a.status).toBe('ENDED');
    for (const r of rows) expect(r.serverTime.getTime()).toBeLessThan(a.endsAt.getTime());
    expect(a.endedAt!.getTime()).toBeGreaterThanOrEqual(a.endsAt.getTime());
    const late = results.filter((r) => r.status === 409);
    expect(late.length).toBeGreaterThan(0);
    const deals = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
    expect(deals).toHaveLength(1);
    expect(deals[0]!.winningBidId).toBe(a.winningBidId);
    expect(deals[0]!.salePrice).toBe(a.currentBid);
    expect(deals[0]!.buyerCompanyId).toBe(a.currentBidderCompanyId);
  });

  it('30 Auktionen mit identischer Endzeit, 50 Bieter, 3 parallele Scheduler: je Auktion höchstens ein Deal', async () => {
    const ids: string[] = [];
    for (let k = 0; k < 30; k++) {
      const v = await fixtureApprovedVehicle(seller.companyId!);
      ids.push(await activeAuction(admin, v.id, { startPrice: 500_000, bidIncrement: 10_000, antiSnipeMinutes: 0, reservePrice: k % 3 === 0 ? 5_000_000 : null }));
    }
    const bidders = dealers.slice(0, 50);
    // 50 Bieter gleichzeitig aktiv; jeder Bieter sendet seine Gebote nacheinander (wie ein echter Client).
    await Promise.all(
      bidders.map(async (d, bi) => {
        for (const [ai, id] of ids.entries()) {
          if ((bi + ai) % 4 !== 0) continue;
          const r = await http('POST', `/auctions/${id}/bids`, { cookie: d.cookie, body: { amount: 500_000 + bi * 10_000, clientRequestId: crypto.randomUUID(), confirmBinding: true } });
          expect([201, 409]).toContain(r.status);
        }
      }),
    );
    const endsAt = new Date(Date.now() - 100);
    await db.update(schema.auctions).set({ endsAt }).where(sql`${schema.auctions.id} = ANY(${sql.raw(`ARRAY[${ids.map((x) => `'${x}'`).join(',')}]::uuid[]`)})`);
    const schedulers = [new AuctionScheduler(), new AuctionScheduler(), new AuctionScheduler()];
    await Promise.all(schedulers.map((s) => s.tick()));
    await schedulers[0]!.tick();
    for (const [k, id] of ids.entries()) {
      const { a } = await invariants(id);
      expect(a.status).toBe('ENDED');
      const deals = await db.select().from(schema.deals).where(eq(schema.deals.auctionId, id));
      if (k % 3 === 0) {
        expect(a.outcome === 'RESERVE_NOT_MET' || a.outcome === 'NO_BIDS').toBe(true);
        expect(deals).toHaveLength(0);
      } else if (a.bidCount > 0) {
        expect(a.outcome).toBe('SOLD');
        expect(deals).toHaveLength(1);
        expect(deals[0]!.salePrice).toBe(a.currentBid);
      } else {
        expect(deals).toHaveLength(0);
      }
    }
  });
});

describe('Realtime', () => {
  it('Gebot von Händler A erscheint nahezu sofort bei Händler B (WebSocket, serverseitig)', async () => {
    const v = await fixtureApprovedVehicle(seller.companyId!);
    const id = await activeAuction(admin, v.id, { antiSnipeMinutes: 0 });
    const A = dealers[0]!;
    const B = dealers[1]!;
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/v1/ws`, { headers: { cookie: B.cookie, origin: ORIGIN } });
    const received = new Promise<{ data: { currentBid: number; bidCount: number; leaderLabel: number }; at: number }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Kein Realtime-Event erhalten')), 5000);
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'subscribe', channel: `auction:${id}` }));
        if (msg.type === 'subscribed') void http('POST', `/auctions/${id}/bids`, { cookie: A.cookie, body: { amount: 1_000_000, clientRequestId: crypto.randomUUID(), confirmBinding: true } }).then(() => (sentAt = Date.now()));
        if (msg.type === 'event' && msg.event === 'bid') {
          clearTimeout(timer);
          resolve({ data: msg.data, at: Date.now() });
        }
      });
    });
    let sentAt = Date.now();
    const evt = await received;
    ws.close();
    expect(evt.data.currentBid).toBe(1_000_000);
    expect(evt.data.bidCount).toBe(1);
    expect(JSON.stringify(evt.data)).not.toContain(A.companyId);
    expect(evt.at - sentAt).toBeLessThan(1000);
  });

  it('WebSocket lehnt fremde Origins und nicht angemeldete Clients ab; fremde Auktionskanäle sind gesperrt', async () => {
    const closeCode = (headers: Record<string, string>) =>
      new Promise<number>((resolve) => {
        const ws = new WebSocket(`${base.replace('http', 'ws')}/api/v1/ws`, { headers });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => undefined);
      });
    expect(await closeCode({ origin: ORIGIN })).toBe(4001);
    expect(await closeCode({ origin: 'https://evil.example', cookie: dealers[0]!.cookie })).toBe(4003);

    const group = await http('POST', '/admin/dealer-groups', { cookie: await loginHttp(admin.email), body: { name: `G-${crypto.randomUUID().slice(0, 6)}`, description: null } });
    const v = await fixtureApprovedVehicle(seller.companyId!);
    const id = await activeAuction(admin, v.id, { dealerGroupId: group.body.id });
    const reply = await new Promise<{ type: string; code?: string }>((resolve) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/api/v1/ws`, { headers: { cookie: dealers[2]!.cookie, origin: ORIGIN } });
      ws.on('message', (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === 'hello') ws.send(JSON.stringify({ type: 'subscribe', channel: `auction:${id}` }));
        if (msg.type === 'error' || msg.type === 'subscribed') {
          ws.close();
          resolve(msg);
        }
      });
    });
    expect(reply.type).toBe('error');
    expect(reply.code).toBe('FORBIDDEN');
  });
});
