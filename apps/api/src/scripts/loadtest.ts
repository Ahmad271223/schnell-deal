/**
 * Lasttest für die Beta (Spezifikation §53).
 *
 *   pnpm --filter @sd/api loadtest
 *
 * Legt Testdaten in der Datenbank `schnelldeal_loadtest` an, startet die API als eigenen Prozess (Port 4200,
 * mit eingebettetem Worker) und simuliert:
 *  1. 100 gleichzeitig eingeloggte Benutzer (Login + WebSocket-Verbindung)
 *  2. 50 gleichzeitige Bieter auf 30 aktive Auktionen (60 s Dauerlast)
 *  3. große Bild-Uploads (20 × ~8 MB parallel)
 *  4. 30 Auktionen mit identischer Endzeit (drei parallele Scheduler in diesem Prozess)
 * Danach werden die Invarianten geprüft und ein Bericht nach docs/lasttest-ergebnis.md geschrieben.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import sharp from 'sharp';
import WebSocket from 'ws';
import { Agent, setGlobalDispatcher } from 'undici';

const PORT = 4200;
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const ORIGIN = 'http://localhost:3000';
const DB_URL = 'postgres://schnelldeal:schnelldeal@localhost:55432/schnelldeal_loadtest';
const USERS = 100;
const BIDDERS = 50;
const AUCTIONS = 30;
const BID_PHASE_MS = Number(process.env.LOADTEST_BID_SECONDS ?? 60) * 1000;
const UPLOADS = 20;

Object.assign(process.env, {
  NODE_ENV: 'development',
  PORT: String(PORT),
  DATABASE_URL: DB_URL,
  DATABASE_POOL_MAX: '30',
  S3_BUCKET: 'schnelldeal-test',
  ALLOWED_ORIGINS: ORIGIN,
  RATE_LIMIT_DISABLED: 'true', // alle Clients kommen von einer IP; produktiv gelten Limits pro Benutzer
  WORKER_MODE: 'inline',
  SCHEDULER_ENABLED: 'false', // der Scheduler wird unten explizit gestartet
  LOG_LEVEL: 'error',
});
setGlobalDispatcher(new Agent({ connections: 256, pipelining: 1, keepAliveTimeout: 30_000 }));

const here = path.dirname(fileURLToPath(import.meta.url));
const PASSWORD = 'Lasttest-2026-Passwort';

// ---------------------------------------------------------------- Messung
const samples = new Map<string, number[]>();
const errors = new Map<string, number>();
function record(name: string, ms: number) {
  if (!samples.has(name)) samples.set(name, []);
  samples.get(name)!.push(ms);
}
function fail(name: string) {
  errors.set(name, (errors.get(name) ?? 0) + 1);
}
function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

async function timed<T>(name: string, fn: () => Promise<Response>, ok: (r: Response) => boolean = (r) => r.ok): Promise<{ res: Response | null; body: T | null }> {
  const t = performance.now();
  try {
    const res = await fn();
    const text = await res.text();
    record(name, performance.now() - t);
    if (!ok(res)) fail(`${name} (HTTP ${res.status})`);
    return { res, body: text ? (JSON.parse(text) as T) : null };
  } catch (e) {
    fail(`${name} (${(e as Error).message})`);
    return { res: null, body: null };
  }
}

function req(method: string, url: string, cookie?: string, body?: unknown) {
  return fetch(`${BASE}${url}`, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function login(email: string): Promise<string> {
  const t = performance.now();
  const res = await req('POST', '/auth/login', undefined, { email, password: PASSWORD });
  record('POST /auth/login', performance.now() - t);
  if (!res.ok) throw new Error(`Login ${email}: ${res.status}`);
  return res.headers.getSetCookie().find((c) => c.startsWith('sd_session='))!.split(';')[0]!;
}

// ---------------------------------------------------------------- API-Prozess
// Die API läuft getrennt vom Lastgenerator, damit Client-Last (100 WebSockets, 50 Bieter) die Messwerte nicht verfälscht.
let apiProcess: ChildProcess | null = null;

async function startApi(): Promise<void> {
  // Ein einzelner Node-Prozess mit tsx-Loader (ohne Shell-Zwischenprozess), damit er sich zuverlässig beenden lässt.
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: path.resolve(here, '../..'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  apiProcess = child;
  const relay = (chunk: Buffer) => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) console.log(`[api] ${line}`);
  };
  child.stdout?.on('data', relay);
  child.stderr?.on('data', relay);
  child.on('exit', (code, signal) => {
    if (apiProcess === child) console.error(`[api] Prozess unerwartet beendet: code=${code} signal=${signal}`);
  });
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      // noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Der API-Prozess wurde nicht rechtzeitig bereit.');
}

function stopApi(): void {
  const child = apiProcess;
  apiProcess = null;
  child?.kill();
}

// ---------------------------------------------------------------- Ablauf
async function main() {
  const startedAt = new Date();
  console.log('Datenbank zurücksetzen …');
  const admin = new pg.Client({ connectionString: DB_URL });
  await admin.connect();
  await admin.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
  await admin.end();

  const { runMigrations } = await import('../core/db/migrate');
  const { db, pool, schema } = await import('../core/db/client');
  const { AuctionScheduler } = await import('../modules/auctions/scheduler');
  const { ensureLegalTemplates, ensureSettings } = await import('./seed-base');
  const { hashPassword } = await import('../core/auth');
  const { activeLegalDocuments } = await import('../modules/legal/service');
  const { sql, eq } = await import('drizzle-orm');

  await runMigrations();
  await db.transaction(async (tx) => {
    await ensureLegalTemplates(tx);
    await ensureSettings(tx);
  });

  console.log('Testdaten anlegen …');
  const hash = await hashPassword(PASSWORD);
  const legal = await activeLegalDocuments(db);
  const [dealership] = await db
    .insert(schema.companies)
    .values({ type: 'DEALERSHIP', name: 'Lasttest Autohaus', legalForm: 'GmbH', street: 'A', houseNumber: '1', zip: '30159', city: 'Hannover', contactFirstName: 'L', contactLastName: 'T', contactPhone: '+49 1', contactEmail: 'lt-ah@test.local', status: 'APPROVED' })
    .returning();
  const [adminUser] = await db.insert(schema.users).values({ email: 'lt-admin@test.local', passwordHash: hash, firstName: 'Last', lastName: 'Admin', platformRole: 'ADMIN' }).returning();
  const [inspector] = await db.insert(schema.users).values({ email: 'lt-inspector@test.local', passwordHash: hash, firstName: 'Last', lastName: 'Inspektor', platformRole: 'INSPECTOR' }).returning();
  const dealers: { email: string; companyId: string }[] = [];
  for (let i = 0; i < USERS; i++) {
    const email = `lt-dealer-${i}@test.local`;
    const [c] = await db
      .insert(schema.companies)
      .values({ type: 'DEALER', name: `Lasttest Händler ${i}`, legalForm: 'GmbH', street: 'B', houseNumber: String(i), zip: '30880', city: 'Laatzen', vatId: 'DE1', contactFirstName: 'L', contactLastName: String(i), contactPhone: '+49 1', contactEmail: email, status: 'APPROVED' })
      .returning();
    const [u] = await db.insert(schema.users).values({ email, passwordHash: hash, firstName: 'Händler', lastName: String(i), platformRole: 'USER' }).returning();
    await db.insert(schema.companyUsers).values({ companyId: c!.id, userId: u!.id, companyRole: 'OWNER' });
    await db.insert(schema.dealerVerifications).values({ companyId: c!.id, biddingStatus: 'CAN_BID' });
    await db.insert(schema.legalAcceptances).values(legal.map((l) => ({ userId: u!.id, companyId: c!.id, legalDocumentId: l.id })));
    dealers.push({ email, companyId: c!.id });
  }
  const auctionIds: string[] = [];
  const now = Date.now();
  for (let i = 0; i < AUCTIONS; i++) {
    const [v] = await db
      .insert(schema.vehicles)
      .values({
        internalNumber: `LT-${String(i).padStart(4, '0')}`,
        companyId: dealership!.id,
        vin: `WVWZZZLT${String(i).padStart(9, '0')}`,
        make: 'Volkswagen',
        model: 'Passat',
        firstRegistration: '2021-01-01',
        mileageKm: 50_000 + i,
        fuel: 'DIESEL',
        transmission: 'AUTOMATIC',
        status: 'IN_AUCTION',
        approvedAt: new Date(),
        completenessPct: 100,
        locationZip: '30159',
        locationCity: 'Hannover',
      })
      .returning();
    const [a] = await db
      .insert(schema.auctions)
      .values({
        number: `LT-A-${i}`,
        vehicleId: v!.id,
        status: 'ACTIVE',
        startsAt: new Date(now - 60_000),
        endsAt: new Date(now + 3600_000),
        originalEndsAt: new Date(now + 3600_000),
        startedAt: new Date(now - 60_000),
        durationMinutes: 61,
        startPrice: 500_000,
        reservePrice: i % 5 === 0 ? 50_000_000 : null,
        bidIncrement: 10_000,
        taxType: 'DIFFERENZBESTEUERT',
        antiSnipeMinutes: 0,
        buyerFeeFixed: 19_900,
        sellerFeeFixed: 9_900,
      })
      .returning();
    auctionIds.push(a!.id);
  }
  // Aufnahmeauftrag + Fahrzeug für Upload-Test
  const [request] = await db
    .insert(schema.inspectionRequests)
    .values({ number: 'LT-AU-1', companyId: dealership!.id, createdBy: adminUser!.id, vehicleCount: 1, locationStreet: 'A 1', locationZip: '30159', locationCity: 'Hannover', requestedDate: '2026-10-02', earliestTime: '08:00', latestTime: '18:00', contactName: 'X', contactPhone: '+49 1', vehiclesDrivable: true, keysAvailable: true, papersAvailable: true, status: 'IN_PROGRESS' })
    .returning();
  await db.insert(schema.inspectionAssignments).values({ requestId: request!.id, inspectorUserId: inspector!.id, assignedBy: adminUser!.id, scheduledAt: new Date() });

  console.log('API als eigenen Prozess starten …');
  await startApi();
  const scheduler = new AuctionScheduler();
  /** Wartet, bis alle Jobs eines Typs abgearbeitet sind (Worker im API-Prozess). */
  const waitForJobs = async (type: string, timeoutMs: number) => {
    const t = performance.now();
    for (;;) {
      const open = (await db.execute<{ n: number }>(sql`select count(*)::int as n from jobs where type = ${type} and status in ('PENDING', 'RUNNING')`)).rows[0]!.n;
      if (open === 0 || performance.now() - t > timeoutMs) return { ms: performance.now() - t, open };
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  // ---------------- Phase 1: 100 Logins + WebSockets
  console.log(`Phase 1: ${USERS} Benutzer melden sich an und verbinden WebSockets …`);
  const t1 = performance.now();
  const cookies = await Promise.all(dealers.map((d) => login(d.email)));
  // Latenzmessung ohne Uhrenvergleich zwischen Rechner und Datenbank-Container: Ein Gebot und das daraus entstehende
  // WebSocket-Ereignis werden über Auktion + Gebotszähler zugeordnet (beide Werte liefert auch die HTTP-Antwort).
  const bidSentAt = new Map<string, number>();
  const bidArrivals: { key: string; at: number }[] = [];
  let wsEvents = 0;
  const sockets: WebSocket[] = [];
  await Promise.all(
    cookies.map(
      (cookie, i) =>
        new Promise<void>((resolve) => {
          const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/v1/ws`, { headers: { cookie, origin: ORIGIN } });
          sockets.push(ws);
          ws.on('message', (raw) => {
            const msg = JSON.parse(String(raw));
            if (msg.type === 'hello') {
              // Jeder Benutzer beobachtet 10 Auktionen.
              for (let k = 0; k < 10; k++) ws.send(JSON.stringify({ type: 'subscribe', channel: `auction:${auctionIds[(i + k * 3) % AUCTIONS]}` }));
              resolve();
            }
            if (msg.type === 'event' && msg.event === 'bid') {
              wsEvents++;
              bidArrivals.push({ key: `${msg.data.auctionId}:${msg.data.bidCount}`, at: performance.now() });
            }
          });
          ws.on('error', () => (fail('WebSocket'), resolve()));
          ws.on('close', () => resolve());
        }),
    ),
  );
  const phase1Ms = performance.now() - t1;
  const connected = sockets.filter((s) => s.readyState === WebSocket.OPEN).length;

  // ---------------- Phase 2: 50 Bieter, 30 Auktionen
  console.log(`Phase 2: ${BIDDERS} Bieter bieten ${BID_PHASE_MS / 1000} s lang auf ${AUCTIONS} Auktionen …`);
  // Auktionsfenster nach Datenbankuhr neu setzen: Eine lange Phase 1 (z. B. Ruhezustand des Rechners) darf die Bietphase nicht entwerten.
  await db.execute(sql`update auctions set ends_at = clock_timestamp() + interval '1 hour', original_ends_at = clock_timestamp() + interval '1 hour' where status = 'ACTIVE'`);
  const bidStop = Date.now() + BID_PHASE_MS;
  let accepted = 0;
  let rejected = 0;
  const rejectionReasons = new Map<string, number>();
  await Promise.all(
    cookies.slice(0, BIDDERS).map(async (cookie, b) => {
      while (Date.now() < bidStop) {
        const auctionId = auctionIds[Math.floor(Math.random() * AUCTIONS)]!;
        const st = await timed<{ minNextBid: number }>('GET /auctions/:id/state', () => req('GET', `/auctions/${auctionId}/state`, cookie));
        if (!st.body) {
          await new Promise((res) => setTimeout(res, 250));
          continue;
        }
        const useMax = Math.random() < 0.15;
        const amount = st.body.minNextBid + Math.floor(Math.random() * 3) * 10_000;
        const sentAt = performance.now();
        type BidResponse = { bidCount: number; duplicate: boolean };
        const r = useMax
          ? await timed<BidResponse>('PUT /auctions/:id/max-bid', () => req('PUT', `/auctions/${auctionId}/max-bid`, cookie, { maxAmount: amount + 100_000, clientRequestId: crypto.randomUUID(), confirmBinding: true }), (x) => x.ok || x.status === 409)
          : await timed<BidResponse>('POST /auctions/:id/bids', () => req('POST', `/auctions/${auctionId}/bids`, cookie, { amount, clientRequestId: crypto.randomUUID(), confirmBinding: true }), (x) => x.ok || x.status === 409);
        if (r.res?.ok) {
          accepted++;
          // Ein Maximalgebot ohne neuen Gebotsdatensatz behält den Zähler bei; der erste Absender bleibt maßgeblich.
          const key = `${auctionId}:${r.body?.bidCount}`;
          if (r.body && !r.body.duplicate && !bidSentAt.has(key)) bidSentAt.set(key, sentAt);
        } else {
          rejected++;
          const reason = (r.body as { error?: { code?: string } } | null)?.error?.code ?? `HTTP ${r.res?.status ?? 'ohne Antwort'}`;
          rejectionReasons.set(reason, (rejectionReasons.get(reason) ?? 0) + 1);
        }
        await new Promise((res) => setTimeout(res, 50 + Math.random() * 250));
        void b;
      }
    }),
  );
  await new Promise((r) => setTimeout(r, 1000)); // letzte WebSocket-Ereignisse zustellen lassen
  const wsLatencies = bidArrivals.flatMap((a) => {
    const sent = bidSentAt.get(a.key);
    return sent === undefined ? [] : [a.at - sent];
  });

  // ---------------- Phase 3: große Uploads
  console.log(`Phase 3: ${UPLOADS} Uploads à ~8 MB …`);
  const inspectorCookie = await login('lt-inspector@test.local');
  const created = await (await req('POST', `/inspector/requests/${request!.id}/vehicles`, inspectorCookie, {})).json() as { id: string };
  const big = await sharp({ create: { width: 3200, height: 2400, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: 'gaussian', mean: 128, sigma: 60 } } }).jpeg({ quality: 97 }).toBuffer();
  const t3 = performance.now();
  const slots = ['FRONT_LEFT_45', 'FRONT', 'FRONT_RIGHT_45', 'RIGHT_SIDE', 'REAR_RIGHT_45', 'REAR', 'REAR_LEFT_45', 'LEFT_SIDE', 'ROOF', 'ENGINE_BAY', 'TRUNK_OPEN', 'DRIVER_SEAT', 'DASHBOARD', 'ODOMETER', 'INFOTAINMENT', 'FRONT_SEATS', 'REAR_SEATS', 'HEADLINER', 'KEYS', 'VIN_PLATE'];
  await Promise.all(
    slots.slice(0, UPLOADS).map(async (slot, i) => {
      const file = Buffer.concat([big, Buffer.from(String(i))]); // unterschiedliche Prüfsummen
      const fd = new FormData();
      fd.append('slot', slot);
      fd.append('clientUploadId', crypto.randomUUID());
      fd.append('file', new Blob([file], { type: 'image/jpeg' }), `${slot}.jpg`);
      const t = performance.now();
      const res = await fetch(`${BASE}/vehicles/${created.id}/photos`, { method: 'POST', headers: { origin: ORIGIN, cookie: inspectorCookie }, body: fd });
      record('POST /vehicles/:id/photos (8 MB)', performance.now() - t);
      if (res.status !== 201) fail(`Upload (HTTP ${res.status}: ${(await res.text()).slice(0, 120)})`);
      else await res.text();
    }),
  );
  const phase3Ms = performance.now() - t3;
  // Zeit nach Upload-Ende, bis der Worker alle Web-Versionen und Vorschaubilder erzeugt hat (trotz E-Mail-Rückstau).
  const images = await waitForJobs('image.process', 180_000);
  const derivativesMs = images.ms;

  // ---------------- Phase 4: 30 Auktionen mit identischer Endzeit
  console.log(`Phase 4: ${AUCTIONS} Auktionen enden gleichzeitig …`);
  // Maßgeblich ist die Datenbankuhr (wie beim serverseitigen Auktionsende), nicht die Uhr dieses Rechners.
  await db.execute(sql`update auctions set ends_at = clock_timestamp() + interval '2 seconds' where status = 'ACTIVE'`);
  const due = async () => (await db.execute<{ due: boolean }>(sql`select coalesce(clock_timestamp() >= max(ends_at), true) as due from auctions where status = 'ACTIVE'`)).rows[0]!.due;
  while (!(await due())) await new Promise((r) => setTimeout(r, 50));
  const t4 = performance.now();
  // Drei parallele Scheduler-Instanzen wie bei horizontaler Skalierung.
  const extra = [new AuctionScheduler(), new AuctionScheduler()];
  await Promise.all([scheduler.tick(), ...extra.map((s) => s.tick())]);
  while ((await db.execute<{ n: number }>(sql`select count(*)::int as n from auctions where status = 'ACTIVE'`)).rows[0]!.n > 0) {
    await scheduler.tick();
    await new Promise((r) => setTimeout(r, 50));
  }
  const phase4Ms = performance.now() - t4;
  const pdfJobs = await waitForJobs('pdf.deal', 180_000);

  // ---------------- Invarianten
  console.log('Invarianten prüfen …');
  const checks: [string, boolean, string][] = [];
  const multiWinning = (await db.execute<{ n: number }>(sql`select count(*)::int as n from (select auction_id from bids where status='WINNING' group by auction_id having count(*) > 1) x`)).rows[0]!.n;
  checks.push(['Höchstens ein führendes Gebot je Auktion', multiWinning === 0, `${multiWinning} Verstöße`]);
  const seqGaps = (await db.execute<{ n: number }>(sql`select count(*)::int as n from (select auction_id, max(sequence) m, count(*) c from bids group by auction_id) x where m <> c`)).rows[0]!.n;
  checks.push(['Gebotssequenzen lückenlos', seqGaps === 0, `${seqGaps} Auktionen mit Lücken`]);
  const mismatch = (await db.execute<{ n: number }>(sql`select count(*)::int as n from auctions a where a.bid_count > 0 and a.current_bid <> (select max(amount) from bids b where b.auction_id = a.id)`)).rows[0]!.n;
  checks.push(['Aktuelles Gebot = höchstes gespeichertes Gebot', mismatch === 0, `${mismatch} Abweichungen`]);
  const late = (await db.execute<{ n: number }>(sql`select count(*)::int as n from bids b join auctions a on a.id = b.auction_id where b.server_time >= a.ends_at`)).rows[0]!.n;
  checks.push(['Keine Gebote nach Auktionsende', late === 0, `${late} späte Gebote`]);
  const doubleDeals = (await db.execute<{ n: number }>(sql`select count(*)::int as n from (select auction_id from deals group by auction_id having count(*) > 1) x`)).rows[0]!.n;
  checks.push(['Höchstens ein Deal je Auktion', doubleDeals === 0, `${doubleDeals} Verstöße`]);
  const sold = (await db.execute<{ n: number }>(sql`select count(*)::int as n from auctions where outcome = 'SOLD'`)).rows[0]!.n;
  const deals = (await db.execute<{ n: number }>(sql`select count(*)::int as n from deals`)).rows[0]!.n;
  checks.push(['Jede verkaufte Auktion hat genau einen Deal', sold === deals, `${sold} verkauft, ${deals} Deals`]);
  const dealMismatch = (await db.execute<{ n: number }>(sql`select count(*)::int as n from deals d join auctions a on a.id = d.auction_id where d.sale_price <> a.current_bid or d.buyer_company_id <> a.current_bidder_company_id`)).rows[0]!.n;
  checks.push(['Deal entspricht dem Höchstgebot', dealMismatch === 0, `${dealMismatch} Abweichungen`]);
  const reserveSold = (await db.execute<{ n: number }>(sql`select count(*)::int as n from deals d join auctions a on a.id = d.auction_id where a.reserve_price is not null and d.sale_price < a.reserve_price`)).rows[0]!.n;
  checks.push(['Kein Verkauf unter Mindestpreis', reserveSold === 0, `${reserveSold} Verstöße`]);
  const docs = (await db.execute<{ n: number }>(sql`select count(*)::int as n from generated_documents`)).rows[0]!.n;
  checks.push(['PDFs für alle Deals erzeugt (3 je Deal)', docs === deals * 3, `${docs} Dokumente für ${deals} Deals`]);
  const photos = (await db.execute<{ n: number }>(sql`select count(*)::int as n from vehicle_photos where upload_status = 'PROCESSED'`)).rows[0]!.n;
  checks.push(['Alle großen Uploads verarbeitet (Web/Thumb)', photos === UPLOADS, `${photos}/${UPLOADS}`]);
  const totalBids = (await db.execute<{ n: number }>(sql`select count(*)::int as n from bids`)).rows[0]!.n;
  // Plausibilität: Die Invarianten oben sind nur aussagekräftig, wenn tatsächlich geboten und verkauft wurde.
  checks.push(['Bietphase hat Gebote erzeugt', accepted > 0 && totalBids > 0, `${accepted} angenommene Anfragen, ${totalBids} Gebotsdatensätze`]);
  const expectedSold = (await db.execute<{ n: number }>(sql`select count(*)::int as n from auctions where bid_count > 0 and reserve_price is null`)).rows[0]!.n;
  checks.push(['Jede Auktion mit Geboten und ohne Mindestpreis wurde verkauft', expectedSold > 0 && sold === expectedSold, `${sold} verkauft, ${expectedSold} erwartet`]);
  checks.push(['Live-Ereignisse kamen bei beobachtenden Bietern an', wsLatencies.length > 0, `${wsLatencies.length} zugeordnete Ereignisse`]);
  const finishedAt = new Date();

  // ---------------- Bericht
  const mail = (await db.execute<{ done: number; open: number }>(sql`select count(*) filter (where status = 'DONE')::int as done, count(*) filter (where status in ('PENDING', 'RUNNING'))::int as open from jobs where type = 'email.send'`)).rows[0]!;
  const lines: string[] = [];
  lines.push('# Lasttest-Ergebnis', '');
  lines.push(`Durchgeführt: ${startedAt.toISOString()} bis ${finishedAt.toISOString()} · Rechner: ${process.platform} / Node ${process.version}.`);
  lines.push('Aufbau: eine API-Instanz als eigener Prozess mit eingebettetem Worker; Lastgenerator, Postgres und MinIO (beide in Docker) auf demselben Rechner.', '');
  lines.push(`**Gesamtergebnis: ${checks.every((c) => c[1]) && errors.size === 0 ? 'bestanden' : 'NICHT bestanden'}**`, '');
  lines.push('## Szenario', '');
  lines.push(`| Parameter | Wert |`, `|---|---|`);
  lines.push(`| Eingeloggte Benutzer mit WebSocket | ${USERS} (verbunden: ${connected}) |`);
  lines.push(`| Gleichzeitige Bieter | ${BIDDERS} |`);
  lines.push(`| Aktive Auktionen | ${AUCTIONS} |`);
  lines.push(`| Dauer Bietphase | ${BID_PHASE_MS / 1000} s |`);
  lines.push(`| Große Uploads | ${UPLOADS} × ${(big.length / 1024 / 1024).toFixed(1)} MB parallel |`);
  lines.push(`| Auktionen mit identischer Endzeit | ${AUCTIONS} (3 parallele Scheduler) |`, '');
  lines.push('## Ergebnisse', '');
  lines.push(`| Messung | Wert |`, `|---|---|`);
  lines.push(`| Phase 1: Logins + WebSocket-Verbindungen | ${(phase1Ms / 1000).toFixed(1)} s |`);
  lines.push(`| Gebote angenommen / fachlich abgelehnt (z. B. überboten) | ${accepted} / ${rejected} |`);
  lines.push(`| Gespeicherte Gebotsdatensätze (inkl. Bietagent) | ${totalBids} |`);
  lines.push(`| WebSocket-Ereignisse zugestellt (davon einem Gebot zugeordnet) | ${wsEvents} (${wsLatencies.length}) |`);
  lines.push(`| Live-Aktualisierung: Gebot abgeschickt bis Anzeige bei beobachtenden Bietern, p50 / p95 / p99 | ${pct(wsLatencies, 50).toFixed(0)} / ${pct(wsLatencies, 95).toFixed(0)} / ${pct(wsLatencies, 99).toFixed(0)} ms |`);
  lines.push(`| Phase 3: ${UPLOADS} Uploads parallel (gesamt) | ${(phase3Ms / 1000).toFixed(1)} s |`);
  lines.push(`| Web-Versionen und Vorschaubilder fertig (nach Upload-Ende) | ${(derivativesMs / 1000).toFixed(1)} s${images.open ? ` – ${images.open} Jobs offen` : ''} |`);
  lines.push(`| Phase 4: ${AUCTIONS} Auktionsenden inkl. Deals | ${(phase4Ms / 1000).toFixed(2)} s |`);
  lines.push(`| Deal-PDFs fertig (nach Auktionsende) | ${(pdfJobs.ms / 1000).toFixed(1)} s${pdfJobs.open ? ` – ${pdfJobs.open} Jobs offen` : ''} |`);
  lines.push(`| E-Mail-Benachrichtigungen versendet / bei Testende noch in der Warteschlange | ${mail.done} / ${mail.open} |`, '');
  lines.push('### Antwortzeiten je Endpunkt', '');
  lines.push(`| Endpunkt | Anzahl | p50 | p95 | p99 | max |`, `|---|---|---|---|---|---|`);
  for (const [name, arr] of [...samples.entries()].sort()) {
    lines.push(`| ${name} | ${arr.length} | ${pct(arr, 50).toFixed(0)} ms | ${pct(arr, 95).toFixed(0)} ms | ${pct(arr, 99).toFixed(0)} ms | ${Math.max(...arr).toFixed(0)} ms |`);
  }
  lines.push('', '### Abgelehnte Gebote nach Grund', '');
  if (rejectionReasons.size === 0) lines.push('Keine.');
  else {
    lines.push('| Grund | Anzahl |', '|---|---|');
    for (const [reason, n] of [...rejectionReasons].sort((x, y) => y[1] - x[1])) lines.push(`| ${reason} | ${n} |`);
  }
  lines.push('', '### Fehler', '');
  if (errors.size === 0) lines.push('Keine technischen Fehler.');
  else for (const [k, n] of errors) lines.push(`- ${k}: ${n}`);
  lines.push('', '## Invarianten', '');
  lines.push(`| Prüfung | Ergebnis | Detail |`, `|---|---|---|`);
  for (const [name, ok, detail] of checks) lines.push(`| ${name} | ${ok ? 'bestanden' : 'NICHT bestanden'} | ${detail} |`);
  lines.push('', 'Hinweis: Ratenbegrenzung war deaktiviert, da alle simulierten Clients von einer IP kommen. Im Betrieb gelten Limits je Benutzer (z. B. 30 Gebote / 10 s).');
  const report = lines.join('\n') + '\n';
  const out = path.resolve(here, '../../../../docs/lasttest-ergebnis.md');
  fs.writeFileSync(out, report);
  console.log(report);

  for (const s of sockets) s.close();
  stopApi();
  await pool.end();
  const allOk = checks.every((c) => c[1]) && errors.size === 0;
  void eq;
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  stopApi();
  process.exit(1);
});
