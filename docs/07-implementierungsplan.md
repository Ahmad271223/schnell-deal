# 07 – Implementierungsplan & Milestones

Jede Phase endet mit: `pnpm typecheck` · `pnpm lint` · `pnpm test` (Unit + Integration gegen echte Postgres-Testdatenbank) · Security-Checkliste der Phase · Regressionslauf aller bisherigen Tests.

## Phase 0 – Fundament
* pnpm-Monorepo: `apps/api`, `apps/web`, `packages/shared`
* Docker Compose: Postgres 16, MinIO (+Bucket-Init, Versionierung), Mailpit
* Drizzle-Schema + Migrationen + DB-Trigger (append-only, Deal-Unveränderlichkeit)
* Fastify-Grundgerüst: Fehlerformat, Zod, Rate-Limit, Origin-Check, Helmet, Logging
* Vitest-Setup mit isolierter Testdatenbank

## Phase 1 – Auth, Unternehmen, Registrierung, Prüfung, Rollen
* Sessions (DB), Login/Logout, Passwort-Hashing (PBKDF2-SHA256, ältere bcrypt-Hashes werden beim Login umgestellt), Session-Invalidierung bei Sperrung
* RBAC-Guards, Mandantenkontext
* Registrierung Autohaus/Händler inkl. Upload (Magic-Byte-Prüfung, Größenlimit)
* Rechtstexte versioniert + Zustimmungen
* Admin: Firmen prüfen/freigeben/ablehnen/sperren, Bieterstatus, Benutzerverwaltung
* Firmen-Selbstverwaltung (Daten, Mitarbeiter)
* Audit-Log-Service
* Tests: Login, Rate-Limit, Registrierung, Statusübergänge, IDOR `/companies/:id`

## Phase 2 – Aufnahmeanfrage, Disposition, Mitarbeiter-App
* Anfrage erstellen (Autohaus), Liste/Status
* Dispositions-Board (Ansichten, Drag & Drop, Kalender/Woche), Zuweisung
* Außendienst: Heute, Termine, Status EN_ROUTE/ON_SITE/IN_PROGRESS, Navigation (geo:/Google-Maps-Link), Anruf (tel:)
* Benachrichtigungen „Auftrag erstellt“, „Fahrer zugewiesen“
* Tests: Zustandsmaschine, Sichtbarkeit (Inspektor sieht nur eigene)

## Phase 3 – Fahrzeugakte, Fotos, Schäden, Prüfwerte
* Fahrzeug anlegen mit interner ID, VIN-Validierung (ISO 3779) + Dubletten
* Foto-Upload (presign/complete + Multipart-Fallback), Idempotenz via `clientUploadId`, Qualitätsprüfung (Laplace-Varianz, Helligkeit), Web/Thumb-Erzeugung im Worker, SHA-256
* Dokumente, Schäden mit Skizze, PDR, Lack (Flagging-Schwellen konfigurierbar), Reifen, OBD (append-only), Batterie, Funktionsprüfung
* Vollständigkeitsberechnung, Abschluss + Sperre, Revisionen
* Client: geführter Stepper, IndexedDB-Upload-Queue, Offline-Fortsetzung
* Tests: VIN, Vollständigkeit, Sperre, Doppel-Upload, Upload-Validierung

## Phase 4 – Adminprüfung, Kataloge, Auktionen
* Review-Queue, Freigeben/Zurückweisen/Kommentar/Korrektur
* Händlergruppen, Kataloge
* Auktion anlegen/planen (Validierung: Fahrzeug APPROVED, Parameter), Scheduler startet automatisch
* Tests: Auktion kann nicht mit unvollständigem Fahrzeug starten

## Phase 5 – Realtime Bidding, Bietagent, Auktionsende
* Gebots-Transaktion mit Row-Lock, Idempotenz, Bietagent, Anti-Sniping
* WebSocket-Hub + Postgres NOTIFY-Bridge, Reconnect-Snapshot
* Scheduler-Sweep (jede Sekunde) für Start/Ende, robust bei Neustart (Zustand komplett in DB)
* Händler-UI: Liste, Filter, Detail, Live-Panel, Verbindlichkeitsdialog, Favoriten
* Admin: Endzeit ändern, Stop, Reserve-nicht-erreicht-Aktionen
* Tests: Concurrency (100 parallele Gebote), Gebot exakt zum Endzeitpunkt, Max-Gebote, Sperrung während Auktion

## Phase 6 – Deal, PDF, Abholung
* Deal-Erzeugung atomar beim Ende, Snapshots, Gebühren/MwSt.
* PDF-Job (Käufer/Verkäufer/Intern), Versionierung, Retry bei Fehler + Admin-Sichtbarkeit fehlgeschlagener Jobs
* Statuskette, Abholung mit Code/QR, Übergabe/Übernahme, Reklamation/Stornierung
* Tests: genau ein Deal, PDF-Versionen, IDOR `/deals/:id`, `/documents/:id`

## Phase 7 – Analytics, Audit, Notifications
* Admin-, Autohaus-, Händler-, Mitarbeiter-Statistiken aus Live-Aggregaten
* Audit-Log-UI
* Notification-Center, E-Mail-Queue mit Retry, Web-Push (VAPID, optional)
* Tests: Statistikwerte gegen bekannte Fixture-Daten

## Phase 8 – Security Review, Concurrency, E2E, Last
* Security-Review-Checkliste (OWASP ASVS L1-Auswahl), IDOR-Testsuite über alle `/:id`-Routen
* E2E (Playwright): kompletter Ablauf Registrierung → Abholung
* Lasttest (Node-Skript/autocannon + WS-Clients): 100 Sessions, 50 Bieter, 30 Auktionen, gleichzeitige Endzeiten, große Uploads
* Backup: `pg_dump`-Job + Restore-Test-Skript, MinIO-Versionierung

## Entscheidungen gegenüber dem Objektkatalog (§48)

| Objekt laut Spezifikation | Umsetzung | Begründung |
|---|---|---|
| Role | Postgres-Enums `platform_role` und `company_role` statt eigener Tabelle | Feste, im Code geprüfte Rollen; kein dynamisches Rechtemodell nötig |
| Employee | Außendienst = Benutzer mit Rolle `INSPECTOR`, Firmenmitarbeiter = `company_users` | Ein Identitätsmodell für alle Konten |
| AuctionVehicle | in `auctions` aufgegangen (eine Auktion je Fahrzeug); Gruppierung über `catalogs`/`catalog_vehicles` | Zeitauktion pro Fahrzeug mit eigenen Parametern (§23) |
| Zusätzlich | `auction_bidders` (anonyme Bieternummern), `deal_status_history`, `vehicle_revisions`, `jobs` (Hintergrundjobs), `sessions` | Nachvollziehbarkeit, Realtime-Anonymisierung, Ausfallsicherheit |

## Technische Entscheidungen während der Umsetzung

| Geplant | Umgesetzt | Begründung |
|---|---|---|
| pg-boss als Job-Queue | Eigene Queue in der Tabelle `jobs` (`FOR UPDATE SKIP LOCKED`, Prioritäten, Backoff, Reaper) | Jobs entstehen in derselben Transaktion wie die fachliche Änderung; volle Kontrolle über Prioritäten. Der Lasttest zeigte, dass Deal-PDFs ohne Prioritäten hinter einem E-Mail-Rückstau warten. |
| bcrypt (Kosten 12, reines JavaScript) | PBKDF2-HMAC-SHA256, 600.000 Iterationen, im libuv-Threadpool; ältere bcrypt-Hashes werden beim Login ersetzt | Der Lasttest zeigte, dass 100 gleichzeitige Logins die Ereignisschleife rund 50 s blockierten und damit auch Gebote verzögert hätten. Mit PBKDF2 dauern sie 5,5 s, ohne andere Anfragen zu blockieren. |
| Ein Abfrageintervall für den Worker | Nach jedem fertigen Job wird sofort der nächste geholt | Ein Rückstau (z. B. Überboten-E-Mails) wird ohne Wartezeit abgearbeitet. |

## Bewusst nicht automatisiert

- **OCR der FIN**: Barcode/QR-Scan über die Browser-API `BarcodeDetector` (z. B. Chrome Android) ist umgesetzt; Texterkennung aus Fotos nicht. Das FIN-Foto wird für die Admin-Prüfung gespeichert.
- **„Fahrzeug nicht vollständig im Bild“** wird nicht automatisch erkannt (erfordert Objekterkennung). Die App zeigt bei Außenaufnahmen einen Hinweis; der Admin prüft in der Review-Queue. Unschärfe/Verwacklung, zu dunkel und zu hell werden automatisch erkannt.

## Annahmen
* Geschäftsmodell für PDFs: Plattform vermittelt; Verkäufer = Autohaus, Käufer = Händler. Rechtstexte sind Platzhalter-Vorlagen und als solche gekennzeichnet (§61).
* MwSt.-Satz 19 % (konfigurierbar); Differenzbesteuerung ohne MwSt.-Ausweis auf den Kaufpreis.
* Gebühren: Prozent + Fix je Auktion, Defaults aus Einstellungen.
* Keine echte Zahlungsabwicklung (Beta-Grenze §59): Zahlungseingang bestätigt der Admin manuell.
