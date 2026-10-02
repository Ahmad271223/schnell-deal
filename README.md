# Schnell-Deal – B2B-Fahrzeugauktionsplattform (Beta)

Plattform für Autohäuser (Einlieferer), Plattform-Administration, Außendienst (Fahrzeugaufnahme) und geprüfte Händler (Bieter).
Ablauf: Inzahlungnahme melden → Disposition → geführte Fahrzeugaufnahme (offline-fähig) → Admin-Prüfung → Zeitauktion mit
Live-Geboten → serverseitiges Ende → Deal mit PDFs → Zahlung/Abholung → Statistik und Audit-Log.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/01-architektur.md](docs/01-architektur.md) | Architektur, Technologieentscheidungen, Realtime-Design |
| [docs/02-datenmodell.md](docs/02-datenmodell.md) | Datenbankmodell inkl. Integritäts-Trigger |
| [docs/03-rollenmatrix.md](docs/03-rollenmatrix.md) | Rollen- und Berechtigungsmatrix |
| [docs/04-zustandsmaschinen.md](docs/04-zustandsmaschinen.md) | Zustandsmaschinen, Gebotsalgorithmus |
| [docs/05-api-struktur.md](docs/05-api-struktur.md) | REST-/WebSocket-API |
| [docs/06-seitenstruktur.md](docs/06-seitenstruktur.md) | Seiten je Rolle |
| [docs/07-implementierungsplan.md](docs/07-implementierungsplan.md) | Phasen, Annahmen |
| [docs/08-teststrategie.md](docs/08-teststrategie.md) | Teststrategie |
| [docs/09-security-review.md](docs/09-security-review.md) | Sicherheitsprüfung und offene Punkte |
| [docs/10-abnahme.md](docs/10-abnahme.md) | Abnahme gegen die Definition of Done, Testlauf, behobene Fehler |
| [docs/11-livegang-checkliste.md](docs/11-livegang-checkliste.md) | Was bis zum Livegang fehlt; Nachweis für gleichzeitiges Bieten |
| [docs/lasttest-ergebnis.md](docs/lasttest-ergebnis.md) | Ergebnis des letzten Lasttests |

## Struktur

```
apps/api        Fastify-API, Worker, Auktions-Scheduler (TypeScript, Drizzle, PostgreSQL)
apps/web        Next.js 15 (App Router), Tailwind, TanStack Query, PWA
packages/shared Enums, Zustandsmaschinen, Gebotslogik, Gebühren, Validierung (gemeinsam für API und Web)
e2e             Playwright-Ende-zu-Ende-Test des kompletten Ablaufs
infra           Postgres-Init, Caddy (HTTPS-Reverse-Proxy), Umgebungsvorlagen
scripts         Backup und Wiederherstellungstest
```

## Lokale Entwicklung

Voraussetzungen: Node.js ≥ 22, pnpm 10, Docker.

```bash
pnpm install
```

```bash
docker compose up -d postgres minio minio-init mailpit
```

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

```bash
pnpm --filter @sd/api db:seed:demo
```

```bash
pnpm dev
```

- Web: http://localhost:3000 · API: http://localhost:4000/api/v1/health
- E-Mails (Mailpit): http://localhost:8025 · MinIO-Konsole: http://localhost:9001
- Superadmin und Demo-Konten: siehe `SEED_*` in `apps/api/.env.example`. Demo-Firmen sind mit `[DEMO]` gekennzeichnet; Fahrzeuge entstehen nur über den echten Aufnahmeprozess.
- **KI-Bilderkennung** (FIN vom Foto, „Fahrzeug vollständig im Bild“): `ANTHROPIC_API_KEY` in `apps/api/.env` eintragen (Schlüssel von console.anthropic.com, Modell über `ANTHROPIC_MODEL`). Ohne Schlüssel bleibt die Funktion aus und wird nicht angeboten.
- **Virenscanner lokal:** `docker compose --profile scan up -d clamav` und `CLAMAV_HOST=localhost` in `apps/api/.env`; Live-Test: `CLAMAV_HOST=localhost pnpm --filter @sd/api exec vitest run test/clamav-live.test.ts`.

Postgres läuft auf Port **55432**, um Konflikte mit lokal installierten Postgres-Diensten zu vermeiden.

## Tests

| Befehl | Umfang |
|---|---|
| `pnpm --filter @sd/shared test` | Unit-Tests der Geschäftslogik (Gebote, Bietagent, Anti-Sniping, FIN, Gebühren, Vollständigkeit, Bildqualität) |
| `pnpm --filter @sd/api test` | Integrationstests gegen echte Postgres-/MinIO-Instanzen: Rollen, Mandantentrennung/IDOR, Aufnahme, Auktionen, Deals, PDFs, Statistik |
| `pnpm --filter @sd/api test:concurrency` | 100 parallele Gebote über HTTP, Gebote zum Endzeitpunkt mit 3 parallelen Schedulern, 30 gleichzeitige Auktionsenden, WebSocket-Zustellung |
| `pnpm test:e2e` | Playwright gegen Produktions-Build: Registrierung → Freigabe → Meldung → Disposition → mobile Aufnahme (28 Fotos, Schaden, Ausstattung, Motorvideo) → Prüfung → Auktion im Katalog → Händler-Startseite (Kennzahlen, Reihen zum Wischen) → Auktionsseite (Galerie, Medien-Umschalter, One-Pager mit Schäden, Dokumentenstatus, Karte, Favorit, Verkäufer anonym) → 2 Händler bieten live → Ende → Deal/PDF → Abholung → Statistik/Audit; Bildschirmfotos der Auktionsseite in `e2e/test-results/` |
| `pnpm --filter @sd/api loadtest` | Lasttest (§53): 100 Sitzungen mit WebSocket, 50 Bieter, 30 Auktionen, 20 × 8-MB-Uploads, gleichzeitige Auktionsenden; schreibt `docs/lasttest-ergebnis.md` |
| `pnpm typecheck` · `pnpm lint` | TypeScript- und ESLint-Prüfung aller Pakete (inkl. E2E-Tests) |
| `pnpm verify` | Typecheck, Lint, Unit-, Integrations- und Concurrency-Tests nacheinander |

## Backups

Der Backup-Dienst sichert die Datenbank aus `DATABASE_URL` (auch eine verwaltete Datenbank); die lokale Basissicherung mit WAL-Archiv gilt nur für den Compose-Postgres. `STORAGE_REMOTE` spiegelt zusätzlich den Objektspeicher außer Haus, `ALERT_WEBHOOK_URL` meldet Fehler.

```bash
bash scripts/backup.sh
```

```bash
bash scripts/restore-test.sh
```

```bash
bash scripts/pitr-restore-test.sh
```

`backup.sh` erzeugt einen komprimierten `pg_dump` mit SHA-256-Prüfsumme und Aufbewahrungsfrist und alle 7 Tage (oder mit `--base` sofort) eine Basissicherung in das WAL-Archiv. Postgres archiviert jedes abgeschlossene WAL-Segment (bei Aktivität spätestens alle 5 Minuten). `restore-test.sh` spielt das neueste Backup in eine leere Datenbank ein und vergleicht Zeilenzahlen und Schutz-Trigger. `pitr-restore-test.sh` stellt Basissicherung plus WAL-Archiv in einem Wegwerf-Container bis zu einem Zeitpunkt wieder her und prüft, dass spätere Änderungen fehlen (Point-in-Time-Recovery). Im Compose-Profil `app` läuft der Dienst `backup` täglich; mit `OFFSITE_REMOTE` und `RCLONE_CONFIG_OFFSITE_*` in der Umgebungsdatei kopiert er Dumps und WAL-Archiv per rclone außer Haus (S3, R2, Backblaze, SFTP). Der MinIO-Bucket `schnelldeal-private` ist versioniert.

## Staging / Produktion

```bash
cp infra/env/staging.env.example infra/env/staging.env
```

```bash
APP_ENV_FILE=infra/env/staging.env docker compose --profile app up -d --build
```

Caddy terminiert TLS und leitet `/api/*` (inklusive WebSocket) an die API, alles andere an das Web-Frontend. API und Worker laufen als getrennte Container; der Auktions-Scheduler ist mehrinstanzfähig (`FOR UPDATE SKIP LOCKED`). Für Produktion `infra/env/production.env.example` verwenden.

## Wichtige Hinweise zur Beta

- **Rechtstexte sind Vorlagen.** AGB, Bieterbedingungen und Datenschutz sind als gekennzeichnete Platzhalter hinterlegt und müssen nach juristischer Prüfung im Admin-Bereich (Einstellungen → Rechtstexte) als neue Version veröffentlicht werden. Zustimmungen werden je Version mit Zeitpunkt gespeichert.
- **Zahlungsinformationen** im Käufer-PDF stammen aus den Einstellungen und sind ebenfalls als Vorlage markiert.
- **Support-Kontakt:** Unter Einstellungen → Standardwerte Support-E-Mail und -Telefon eintragen. Erst dann zeigt die Auktionsseite den Händlern „Nachricht senden“ und die Telefonnummer; die Identität des Verkäufers bleibt bis zum Zuschlag verborgen.
- **Compose-Profile:** Ohne Profil startet nur Postgres; `docker compose up -d postgres minio minio-init mailpit` startet die Entwicklungsdienste (Profil `dev`, Ports nur auf 127.0.0.1). Staging/Produktion: `--profile app` ohne MinIO und Mailpit; in der `.env` neben der Compose-Datei müssen `POSTGRES_PASSWORD` und `CSP_STORAGE_ORIGIN` stehen.
- **Livegang-Schutz:** In Produktion startet die API nicht mit Platzhalterwerten, und Auktionen lassen sich erst einplanen, wenn AGB, Bieterbedingungen, Datenschutzerklärung und Impressum keine Vorlagen mehr sind (Einstellungen → Rechtstexte, Systemstatus zeigt den Stand).
- **Motorvideo:** Der Außendienst nimmt es als Schritt 13 der Aufnahme auf (optional), der Admin kann es unter Fahrzeuge → „Fotos & Motor-Video“ nachreichen. Grenze `MAX_VIDEO_UPLOAD_MB` (höchstens 100 wegen des Virenscanners); keine Umkodierung.
- **Hinweis unter jeder Auktion:** Unter Einstellungen → Standardwerte kann der Betreiber einen Hinweistext pflegen; er ersetzt keine Rechtstexte.
- **Kosten und Betrieb** bei 20 Autohäusern, 80 Händlern und 30 Auktionen je Tag: [docs/12-kosten-und-betrieb.md](docs/12-kosten-und-betrieb.md).
- Siehe [docs/09-security-review.md](docs/09-security-review.md) für bewusst offene Punkte (z. B. Kartengenauigkeit).
