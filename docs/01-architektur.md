# 01 – Architektur

Stand: umgesetzte Beta. Abweichungen gegenüber der ursprünglichen Planung sind in `07-implementierungsplan.md` unter „Entscheidungen“ begründet.

## Leitentscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| Stil | Modularer Monolith, pnpm-Monorepo | Beta-Größe (10 Autohäuser, 30 Händler, ~300 Fzg/Monat); horizontal skalierbar ohne Umbau |
| Sprache | TypeScript end-to-end | geteilte Zod-Schemas, Enums, Zustandsmaschinen und Gebotslogik in `packages/shared` |
| Frontend | Next.js 15 (App Router), React 19, Tailwind, TanStack Query, PWA (Manifest, Service Worker, IndexedDB-Warteschlange) | responsive, Desktop (Admin/Händler) + Mobile-first (Außendienst, offlinefähige Aufnahme) |
| Backend | Fastify 5 + Zod-Validierung + Drizzle ORM | schlanke, schnelle API; explizite SQL-Transaktionen für Gebote |
| Datenbank | PostgreSQL 16 | Transaktionen, `SELECT … FOR UPDATE`, LISTEN/NOTIFY, Serverzeit `clock_timestamp()`, Schutz-Trigger (append-only, unveränderliche Kernfelder) |
| Realtime | WebSocket (`@fastify/websocket`) + Postgres `NOTIFY` Fan-out | echte serverseitige Echtzeit; Ereignisse werden erst beim Commit verschickt; mehrere API-Instanzen bleiben synchron |
| Queue/Worker | Eigene Job-Queue in Postgres (Tabelle `jobs`, `FOR UPDATE SKIP LOCKED`) | keine zusätzliche Infrastruktur; Jobs entstehen in derselben Transaktion wie die fachliche Änderung; Prioritäten (Deal-PDFs und Fotos vor Benachrichtigungen), Retry mit Backoff, Reaper für abgebrochene Jobs, Admin-Alarm bei endgültigem Fehlschlag |
| Storage | S3-kompatibel (MinIO dev, S3/R2 prod), private Buckets, Signed URLs (5 min) | keine vorhersehbaren öffentlichen URLs; Original + Web + Thumbnail getrennt |
| Bilder | `sharp` im Worker | Web-Version + Thumbnail ohne EXIF/GPS, Qualitätsmetriken (Schärfe/Helligkeit) |
| Motorvideo | Smartphone-Datei (MP4/WebM/MOV) ohne Umkodierung im privaten Objektspeicher, höchstens 100 MB, Virenscan, Auslieferung per Signed URL nur mit Fahrzeugberechtigung | kein ffmpeg im Betrieb nötig; Browser spielen die Formate direkt |
| PDF | `pdfkit` + `qrcode` im Worker | versionierte Dokumente (Käufer, Verkäufer, intern), alte Versionen bleiben erhalten |
| E-Mail | nodemailer (SMTP mit wiederverwendeten Verbindungen; Mailpit in dev) über die Queue | Ausfall → Retry statt stiller Fehler |
| KI-Bilderkennung | Anthropic Messages API (Claude) mit erzwungenen Werkzeugantworten: FIN vom Foto, „Fahrzeug vollständig im Bild“ | nur Vorschläge, serverseitig validiert; ohne API-Schlüssel abgeschaltet |
| Backups | Täglicher Dump, WAL-Archivierung mit wöchentlicher Basissicherung (Point-in-Time-Recovery), rclone-Kopie außer Haus, Virenscanner-Container | Wiederherstellung ist getestet, nicht nur theoretisch (§46) |
| Auth | DB-Sessions (Token nur als SHA-256 gespeichert), httpOnly/SameSite-Cookie, PBKDF2-SHA256 (600.000 Iterationen, im Threadpool), Origin-Check (CSRF), Rate-Limits | serverseitige Autorisierung bei jedem Request |
| Deployment | Docker Compose: Infrastruktur (Postgres, MinIO, Mailpit) und Profil `app` (Caddy/TLS, API, Worker, Web, Backup); je Umgebung eine eigene `env`-Datei | reproduzierbare Umgebungen für dev, staging, production |

## Komponenten

```
┌─────────────┐   HTTP (/api → rewrite)    ┌─────────────────────────────┐
│  apps/web   │ ─────────────────────────▶ │  apps/api  (Fastify)        │
│  Next.js    │   WebSocket /api/v1/ws     │  ├─ modules/* (Domain)      │
│  (SSR+CSR)  │ ─────────────────────────▶ │  ├─ realtime (WS-Hub)       │
└─────────────┘                            │  ├─ jobs (Job-Worker)       │
                                           │  └─ storage (S3 signed URL) │
                                           └───────┬───────────┬─────────┘
                                                   │           │
                                       ┌───────────▼──┐   ┌────▼──────────┐
                                       │ PostgreSQL 16│   │ MinIO / S3    │
                                       │ (+ Job-Queue)│   │ private bucket│
                                       └──────────────┘   └───────────────┘
```

Der Worker läuft im gleichen Prozess wie die API (`WORKER_MODE=inline`, Standard in dev) oder als eigener Prozess (`WORKER_MODE=separate`, `node dist/worker.js`; im Compose-Profil `app` als Dienst `worker`). Der Auktions-Scheduler (Start und Ende im Sekundentakt) läuft in der API und ist mehrinstanzfähig (`FOR UPDATE SKIP LOCKED`).

## Modulstruktur `apps/api/src`

```
modules/
  auth/           Login, Logout, Session, Passwortwechsel, Rechtstext-Zustimmung
  companies/      Registrierung, Firmendaten, Firmenbenutzer, Gewerbenachweis, Prüfung/Freigabe
  admin/          Benutzer, Außendienst-Mitarbeiter, Unternehmen, Rechtstexte, Einstellungen, Systemstatus, Audit-Log
  inspections/    Aufnahmeanfragen, Disposition, Termine, Außendienst-Aufträge
  vehicles/       Fahrzeugakte, Fotos, Schäden, PDR, Lack, Reifen, OBD, Batterie, Funktionen, Dokumente, Prüfung, Korrektur
  catalogs/       Kataloge, Händlergruppen
  auctions/       Auktionsparameter, Scheduler (Start/Ende), Gebote, Bietagent, Anti-Sniping, Beobachtungsliste
  deals/          Zuschlag, Deal-Statuskette, PDFs, Abholung mit Code/QR, Reklamation, Stornierung
  notifications/  In-App-Benachrichtigungen, Web-Push-Abonnements
  stats/          Kennzahlen Admin, Autohaus, Händler, Außendienst
  legal/          Versionierte Rechtstexte und Zustimmungen (Service)
  realtime/       WebSocket-Endpunkt mit Kanal-Autorisierung
core/
  db/             Drizzle-Schema, Migrationen, Client
  auth.ts         Sessions, Passwort-Hashing, Rollen- und Mandanten-Guards
  audit.ts        Audit-Log (append-only, Geheimnisse werden entfernt)
  realtime.ts     WS-Hub, Kanäle, NOTIFY-Bridge
  jobs.ts         Job-Queue (Prioritäten, Retry, Reaper)
  storage.ts      S3-Client, Signed URLs, Upload-Validierung (Magic Bytes), Virenscan (clamd)
  upload.ts       Multipart-Verarbeitung
  mail.ts         SMTP-Transport
  settings.ts     Plattform-Einstellungen (Gebühren, Fristen, Anti-Sniping-Standard)
  errors.ts       Fehlerklassen und Validierung
jobs/handlers.ts  Job-Handler: E-Mail, Push, Bildverarbeitung, Deal-PDFs
```

## Realtime-Design

* Kanäle: `auction:{auctionId}` (für zugelassene Händler/Admin/Autohaus), `user:{userId}` (Benachrichtigungen), `admin` (Dispositions-Updates). Jedes Abonnement wird serverseitig autorisiert.
* Bid-Flow: `POST /auctions/:id/bids` → Transaktion mit Zeilensperre → `pg_notify` in derselben Transaktion → nach dem Commit an alle API-Instanzen → WS-Broadcast.
* Client sendet Gebote **nie** über WebSocket, nur über HTTP (Rate-Limiting, klare Fehlerantworten, Idempotenz via `clientRequestId`).
* Reconnect: Client holt bei Reconnect den Snapshot (`GET /auctions/:id/state`) und abonniert erneut.
* Mehrere Tabs: jeder Tab eine eigene Verbindung; State kommt ausschließlich vom Server.

## Zeit

Alle auktionsrelevanten Entscheidungen verwenden die Datenbankuhr (`clock_timestamp()`, gelesen nach dem Sperren der Auktion). Der Browser zeigt die Restzeit aus `endsAt` und dem Abstand zur Serverzeit (kommt mit jedem Snapshot und jedem WS-Ereignis), nie aus der Browseruhr allein.

## Skalierung (ohne Neubau)

* API zustandslos → N Instanzen hinter Load Balancer; WS-Fan-out über Postgres NOTIFY.
* Worker separat skalierbar (mehrere Worker holen Jobs konkurrierend mit `FOR UPDATE SKIP LOCKED`).
* Bilder/PDFs ausschließlich im Object Storage.
* Statistiken via SQL-Aggregate + Indizes; später Materialized Views.
* Bekannte Grenze: Rate-Limits sind instanzlokal (für mehrere Instanzen Redis-Store ergänzen, siehe `09-security-review.md`).
