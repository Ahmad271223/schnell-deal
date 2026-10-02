# 10 – Abnahme gegen die Definition of Done (§63)

Legende: **erfüllt** = automatisiert nachgewiesen · **vorbereitet** = umgesetzt, aber außerhalb dieser Umgebung nicht vollständig prüfbar.

| # | Kriterium | Status | Nachweis |
|---|---|---|---|
| 1 | Neues Autohaus kann sich registrieren | erfüllt | E2E Schritt 1 (Oberfläche inkl. Upload); `phase1-auth-companies.test.ts` |
| 2 | Admin kann Gewerbenachweis prüfen und freigeben | erfüllt | E2E Schritt 2 (Nachweis sichtbar, Freigabe); Integrationstest „kompletter Ablauf …“ |
| 3 | Autohaus kann Inzahlungnahme-Anfrage absenden | erfüllt | E2E Schritt 3; `phase2-inspections.test.ts` |
| 4 | Admin kann Mitarbeiter disponieren | erfüllt | E2E Schritt 4 (Mitarbeiter anlegen, zuweisen, Statustext beim Autohaus); Phase-2-Tests inkl. Umdisposition |
| 5 | Mitarbeiter kann unterwegs Fahrzeug vollständig aufnehmen | erfüllt | E2E Schritt 5 (mobiles Viewport, 13 Schritte, 28 Pflichtfotos, Schaden, Lack, Reifen, Funktionen); Phase-3-Tests |
| 6 | Upload bei schlechter Verbindung wird wieder aufgenommen | erfüllt (Logik) | IndexedDB-Warteschlange mit automatischer Wiederaufnahme und idempotenten Client-IDs (`apps/web/src/lib/outbox.ts`); serverseitige Idempotenz getestet (doppelte `clientUploadId`, `clientVehicleId`, Schaden-/OBD-Client-IDs) |
| 7 | Admin kann Fahrzeug kontrollieren | erfüllt | E2E Schritt 6; Phase-3-Test „Abschluss sperrt die Akte, Admin weist zurück, Korrektur, Freigabe“ |
| 8 | Admin kann Auktion planen | erfüllt | E2E Schritt 6 (Formular); Phase-4-Tests |
| 9 | Auktion startet automatisch | erfüllt | Scheduler-Tests (Phase 4), E2E („Läuft“ ohne manuellen Start) |
| 10 | Mindestens 30 Händler können gleichzeitig bieten | erfüllt | Concurrency-Test (100 gleichzeitige Gebote), Lasttest (50 Bieter auf 30 Auktionen) |
| 11 | Live-Gebote werden korrekt synchronisiert | erfüllt | E2E Schritt 7 (Gebot von A erscheint bei B ohne Neuladen, nächster Gebotsschritt und „Sie wurden überboten“ live); WebSocket-Test (< 1 s); Lasttest: Gebot abgeschickt bis Anzeige bei beobachtenden Bietern p99 799 ms bei 50 Dauerbietern |
| 12 | Auktionsende serverseitig korrekt | erfüllt | Concurrency-Test „Gebote zum Endzeitpunkt“; Integrationstest „Gebot nach Ablauf … abgelehnt“; E2E Schritt 8 |
| 13 | Exakt ein Gewinner | erfüllt | Partial-Unique-Index `bids_winning_uq`; Concurrency- und Lasttest-Invarianten |
| 14 | Deal wird automatisch angelegt | erfüllt | Phase-4-6-Tests („genau ein Deal“), 30 parallele Auktionsenden mit 3 Schedulern |
| 15 | PDFs werden automatisch erzeugt | erfüllt | Phase-4-6-Tests (3 PDFs, Versionierung, Stornierung → neue Version); E2E PDF-Download |
| 16 | Verkäufer und Käufer sehen Dokumente | erfüllt | Rollenabhängige Dokumentrechte getestet (Käufer nur Käufer-PDF, Verkäufer nur Verkäufer-PDF, intern nur Admin) |
| 17 | Abholung kann dokumentiert werden | erfüllt | Phase-6-Test (Abholcode, Übergabe, Übernahme, Zeitstempel); E2E Schritt 10 |
| 18 | Statistiken werden korrekt aktualisiert | erfüllt | `phase7-stats.test.ts` mit exakt nachgerechneten Fixture-Werten; E2E Schritt 11 |
| 19 | Jeder relevante Vorgang im Audit-Log | erfüllt | Audit-Einträge in allen Phasen geprüft; DB-Trigger verhindert Änderungen |
| 20 | Kein Nutzer kann fremde Unternehmensdaten abrufen | erfüllt | IDOR-Tests für alle `/:id`-Routen und WebSocket-Kanäle |
| 21 | Automatisierte Tests laufen erfolgreich | erfüllt | siehe Testlauf unten |
| 22 | Staging-Version vollständig getestet | vorbereitet | Compose-Profil `app` (Caddy/TLS, API, Worker, Web, Backup); Docker-Images für API und Web gebaut und gestartet (API-Health-Check mit Datenbank und Objektspeicher grün, Web liefert Login-Seite mit Sicherheits-Headern); ein dedizierter Staging-Server stand in dieser Umgebung nicht zur Verfügung |

## Testlauf

Stand 02.10.2026, lokale Windows-Umgebung (Node 24, Postgres 16 und MinIO in Docker), finaler Code-Stand.

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Typecheck aller Pakete (shared, api, web, e2e) | `pnpm typecheck` | ohne Fehler |
| Lint | `pnpm lint` | ohne Befund |
| Unit-Tests | `pnpm --filter @sd/shared test` | 38 von 38 bestanden |
| Integrationstests (11 Dateien, inkl. KI-Bilderkennung mit nachgebautem Dienst) | `pnpm --filter @sd/api test` | 107 von 107 bestanden, 3 übersprungen (Scanner-Live-Test ohne Scanner) |
| Virenscanner live (echter clamd, EICAR) | `CLAMAV_HOST=localhost … vitest run test/clamav-live.test.ts` | 3 von 3 bestanden |
| Point-in-Time-Recovery (Basissicherung + WAL bis Zeitpunkt T) | `bash scripts/pitr-restore-test.sh` | bestanden: Stand zu T enthält „before“, nicht „after“ |
| Backup-Container mit Kopie außer Haus (rclone → S3-kompatibler Bucket) | `docker compose --profile app run … backup /backup.sh --base` | bestanden: Dump, Prüfsumme, WAL-Archiv und Basissicherungen im Bucket |
| Concurrency-Tests | `pnpm test:concurrency` | 7 von 7 bestanden |
| E2E-Gesamtablauf inkl. Auktionsseite | `pnpm test:e2e` | bestanden (Testdauer 2,4 min) |
| Lasttest | `pnpm loadtest` | bestanden, alle Invarianten und Plausibilitätsprüfungen erfüllt (`docs/lasttest-ergebnis.md`) |
| Backup und Wiederherstellung | `pnpm backup && pnpm restore-test` | bestanden (Dump eingespielt, Zeilenzahlen und Schutz-Trigger identisch) |
| Abhängigkeiten | `pnpm audit --prod` | keine bekannten Schwachstellen |

Lasttest-Kernwerte:

| Messung | Wert |
|---|---|
| 100 gleichzeitige Logins mit WebSocket | 6,2 s |
| Live-Aktualisierung p50 / p95 / p99 | 394 / 630 / 799 ms |
| Gebot abgeben p50 / p95 | 368 / 581 ms |
| Deal-PDFs fertig nach Auktionsende | 0,2 s |
| Web-Versionen und Vorschaubilder nach Upload-Ende | 7,4 s |
| E-Mails bei Testende noch in der Warteschlange | 0 |

### Im Testlauf gefundene und behobene Fehler

- **E2E-Befehl lief ins Leere:** Das E2E-Paket fehlte im pnpm-Workspace, `pnpm test:e2e` meldete trotzdem Erfolg. Behoben; alle gefilterten Skripte brechen jetzt ab, wenn kein Paket passt.
- **Zeitabhängiger E2E-Schritt:** Die minutengenaue Endzeit war je nach Sekunde zu kurz. Der Test wählt jetzt die nächste volle Minute.
- **Virenscanner-Client nicht „fail closed“:** Fehlerantworten oder fehlende Antworten von clamd gaben Dateien frei. Jetzt gibt nur „stream: OK“ frei; Tests gegen einen nachgebauten Dienst.
- **Job-Queue:** Deal-PDFs und Fotos warteten hinter einem Rückstau an E-Mails. Jobs haben jetzt Prioritäten, und der Worker holt nach jedem Job sofort den nächsten.
- **Login-Spitzen blockierten den Server:** bcrypt in reinem JavaScript lief auf der Ereignisschleife; 100 Logins dauerten rund 50 s und hätten Gebote verzögert. Jetzt PBKDF2 im Threadpool (6 s, nicht blockierend); alte Hashes werden beim Login umgestellt.
- **Ratenlimits einzelner Routen** ignorierten den Testschalter.
- **Lasttest selbst:** Latenz wurde über Uhrengrenzen gemessen, ein Lauf ganz ohne Gebote galt als bestanden, und die API teilte sich die Ereignisschleife mit dem Lastgenerator. Alle drei Punkte behoben.
- **Auktionsseite:** Bei schmalen Spalten standen Werte buchstabenweise untereinander, und ein Button war verdeckt. Behoben über Container-Abfragen.
- **Backup-Skripte unter Windows:** Die Git-Bash wandelte Container-Pfade wie `/wal-archive` in Windows-Pfade um; Container-Befehle werden jetzt in einer Shell gekapselt. Außerdem fehlte im Postgres-Image der Replikationseintrag für Basissicherungen über das Netz (Init-Skript ergänzt).

### Nachträglich ergänzt (Auftrag vom 02.10.2026)

- **FIN per KI vom Foto** (§9) und **„Fahrzeug vollständig im Bild“ per KI** (§11) über die Anthropic-API; FIN bleibt Vorschlag bis zur Bestätigung, abgeschnittene Außenaufnahmen zählen als fehlendes Pflichtfoto. 11 Tests mit nachgebautem Dienst; ein Lauf gegen den echten Dienst setzt den API-Schlüssel des Betreibers voraus.
- **Mitarbeiter-Statistik** (§42): zusätzlich „Fahrzeug abgeschnitten (KI)“ und „Fotos nachgefordert“.
- **Virenscanner** (§44) als Compose-Dienst, live getestet.
- **Backups** (§46): WAL-Archivierung, wöchentliche Basissicherung, getestete Zeitpunkt-Wiederherstellung, Kopie außer Haus per rclone.
- **Stiller Hänger im Concurrency-Test:** In einem von vier Läufen blieb ein Scheduler-Takt ohne Fehlermeldung hängen (keine Deadlocks oder Fehler im Postgres-Log; Verdacht: abgerissene Datenbankverbindung über die Docker-Desktop-Portweiterleitung). Folgetests scheiterten irreführend, weil der blockierte Takt still übersprungen wurde. Behoben durch Zeitlimits für Verbindungen und Abfragen, TCP-Keepalive, `idle_in_transaction_session_timeout`, einen Wächter im Scheduler (Protokoll, Health-Endpunkt, Admin-Systemstatus) und klare Abbrüche in den Tests statt stummem Warten.

### Beobachtung in der Testumgebung

In 4 von 17 E2E-Läufen wurde ein lokaler Serverprozess (3× Web-Server, 1× API) ohne Fehlermeldung beendet; einmal blieb der Next.js-Build bei „Collecting page data“ zehn Minuten stehen, während zeitgleich die Browser-Vorschau nicht mehr zeichnete (Wiederholung sofort erfolgreich). Das Windows-Ereignisprotokoll enthält keinen Absturz, und Next.js sowie die API fangen JavaScript-Fehler ab und protokollieren sie; die Prozesse wurden also von außen beendet. Die E2E-Testserver laufen deshalb unter `e2e/scripts/serve.mjs`, das einen solchen Fall protokolliert und den Server neu startet; im letzten betroffenen Lauf lief der Test danach erfolgreich weiter. Im Betrieb übernimmt das die Neustart-Regel der Container (`restart: unless-stopped`).
