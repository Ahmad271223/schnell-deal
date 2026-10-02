# 11 – Was bis zum Livegang noch fehlt

Stand 02.10.2026 (nachts). Die Beta erfüllt 21 von 22 Punkten der Definition of Done (§63) automatisiert nachgewiesen; offen ist der Staging-Durchlauf auf echter Infrastruktur (`10-abnahme.md`). Am 02.10.2026 lief zusätzlich eine unabhängige Livegang-Prüfung (sieben Prüfdimensionen, schwere Befunde von je zwei Gegenprüfern bestätigt); ihre Ergebnisse sind unten eingearbeitet und in Abschnitt E zusammengefasst. **Kurzantwort: Die Plattform ist beta-fähig, aber noch nicht live-fähig.** Was fehlt, steht in A (Blocker) und B. Diese Liste nennt alles, was zwischen „Beta auf dem Entwicklungsrechner“ und „Händler bieten echtes Geld“ liegt. Reihenfolge = empfohlene Reihenfolge. Laufende und einmalige Kosten für 20 Autohäuser, 80 Händler und 30 Auktionen je Tag stehen in `12-kosten-und-betrieb.md`.

## A. Ohne das kein Livegang (Blocker)

| # | Punkt | Wer | Stand |
|---|---|---|---|
| 1 | **Server und Domain.** Linux-Server (empfohlen: 4 vCPU, 8 GB RAM, 100 GB SSD) mit Docker, Domain mit DNS-Einträgen für `auktion.<domain>` und `storage.<domain>`. Caddy holt TLS-Zertifikate automatisch (`infra/Caddyfile`). | Betreiber | offen |
| 2 | **Produktions-Konfiguration.** `infra/env/production.env` aus der Vorlage anlegen: eigene S3-Schlüssel, SMTP-Zugang (derzeit Platzhalter `ersetzen`), `MAIL_FROM` mit eigener Domain, `ANTHROPIC_API_KEY` für die KI-Bilderkennung, Zugangsdaten für die Kopie außer Haus (`OFFSITE_REMOTE`, `RCLONE_CONFIG_OFFSITE_*`, `STORAGE_REMOTE` für Fotos/Videos/PDFs, `ALERT_WEBHOOK_URL`), optional VAPID-Schlüssel für Push. In der `.env` neben `docker-compose.yml`: `POSTGRES_PASSWORD` (muss zur `DATABASE_URL` passen), `CSP_STORAGE_ORIGIN` und bei eingebautem MinIO `CADDYFILE=./infra/Caddyfile.minio` plus `MINIO_ROOT_PASSWORD` (= `S3_PUBLIC_ENDPOINT`; ohne sie bricht der Build ab, mit falschem Wert blockiert der Browser Fotos und Videos). Die API startet in Produktion nicht mit Platzhaltern (`ersetzen`, Entwicklungs-Passwörter, fehlender Virenscanner, example.de/localhost). Dateien nie ins Repository. | Betreiber + Technik | Vorlagen vorhanden, Startprüfung eingebaut |
| 3 | **Staging-Durchlauf (DoD 22).** Kompletter Ablauf auf dem Staging-Server mit echten Geräten: Außendienst-Smartphone (Kamera, 28 Fotos, Motorvideo mit iPhone und Android, Funkloch-Test), Admin am Desktop, zwei Händler-Browser (Desktop und Smartphone: Wischen, Klebeleiste), echter E-Mail-Empfang, PDF-Download, Abholcode. Prüfen, ob iPhone-Videos (HEVC/.mov) in den Händler-Browsern abspielen; sonst Transkodierung nachrüsten. Protokoll in `10-abnahme.md` ergänzen. | Technik + 1 Pilot-Autohaus + 2 Pilot-Händler | offen |
| 4 | **Rechtstexte.** AGB, Bieterbedingungen, Datenschutzerklärung, Kaufvertrags-/PDF-Texte und Zahlungsinformationen sind gekennzeichnete Vorlagen (§61). Juristisch geprüfte Fassungen unter Einstellungen → Rechtstexte als neue Version veröffentlichen; jede Zustimmung wird je Version protokolliert (§60). **Technischer Schutz:** In Produktion lässt sich keine Auktion einplanen oder starten, solange eine Rechtstext-Art Vorlage ist oder fehlt (Fehler `LEGAL_TEMPLATES_ACTIVE`); der Admin-Systemstatus zeigt die betroffenen Arten. Die Datenschutzerklärung muss nennen: Hoster, Objektspeicher, E-Mail-Anbieter, Anthropic (FIN-Foto, Außenaufnahmen), OpenStreetMap-Kacheln (IP-Adresse an die OSM Foundation), Web-Push-Dienste der Browser. | Anwalt + Betreiber | Vorlagen vorhanden, Sperre eingebaut |
| 5 | **Impressum.** Seite `/rechtliches/IMPRINT` ist vorhanden und im öffentlichen Bereich sowie in der Seitenleiste verlinkt; der Inhalt ist eine gekennzeichnete Vorlage und muss vom Betreiber unter Einstellungen → Rechtstexte als Version veröffentlicht werden (§ 5 DDG: Firma, Anschrift, Vertretung, Kontakt, Register, USt-ID). Ohne echtes Impressum greift dieselbe Sperre wie bei den anderen Rechtstexten. | Betreiber (Inhalt) | Seite vorhanden, Inhalt fehlt |
| 5a | **Rechnungen für Plattformgebühren (§ 14 UStG).** Die Plattform vergibt bei jedem Zuschlag Rechnungsnummern für Käufer- und Verkäufergebühr (`invoices`), erzeugt aber kein Rechnungsdokument mit Pflichtangaben (Steuernummer/USt-ID des Betreibers, Rechnungsdatum, Leistungsbeschreibung) und keinen Storno-Beleg. Vor dem ersten Handel: Rechnungs-PDF je Gebühr (wie die Deal-PDFs, versioniert) oder Rechnungsstellung aus der Buchhaltung mit Übernahme der Nummern. | Technik (2 Tage) + Steuerberatung | fehlt |
| 6 | **Virenscanner.** Compose-Dienst `clamav` ist eingebaut und live getestet; `CLAMAV_HOST=clamav` steht in den Vorlagen. Beim ersten Start lädt der Dienst einige Minuten Signaturen, API und Worker warten darauf. | Technik | erledigt |
| 7 | **Backups.** Täglicher Dump, WAL-Archivierung, wöchentliche Basissicherung, Zeitpunkt-Wiederherstellung getestet, Kopie außer Haus per rclone getestet; der Objektspeicher (Fotos, Videos, PDFs) wird mit `STORAGE_REMOTE` ebenfalls außer Haus gespiegelt, Backup-Fehler gehen per `ALERT_WEBHOOK_URL` an den Betreiber. Offen: Zielspeicher außer Haus beauftragen und Zugangsdaten eintragen; **Restore-Runbook** für den Ernstfall schreiben (neuer Server, Dump oder PITR aus der Kopie außer Haus, Objektspeicher zurückspielen) und einmal auf dem Zielserver proben; Backups sind unverschlüsselt (Verschlüsselung des Zielspeichers oder `rclone crypt` einplanen). | Betreiber + Technik (1,5 Tage Runbook + Probe) | technisch fertig, Speicher und Runbook fehlen |
| 7a | **Auftragsverarbeitung KI.** Für die FIN-Erkennung und die Bildprüfung werden Fotos an Anthropic übertragen. Vor dem Livegang Auftragsverarbeitungsvertrag abschließen und in der Datenschutzerklärung nennen; ohne Schlüssel bleibt die Funktion aus. | Betreiber | offen |
| 8 | **Versionsverwaltung und CI.** Repository liegt auf GitHub (`Ahmad271223/schnell-deal`, Branch `main`). Offen: Pipeline, die `pnpm verify` und `pnpm test:e2e` bei jeder Änderung ausführt, Images baut und auf Staging ausrollt; **Branch-Schutz für `main`** mit Pflicht-Pull-Request. Grund: Am 02.10.2026 hat ein externes Werkzeug direkt auf `main` ein Postgres-Datenverzeichnis, Zugangsdaten und sicherheitsrelevante Änderungen (lokaler Dateispeicher, gelockerte Origin-Prüfung) gepusht; das wurde zurückgebaut. Externe Werkzeuge künftig nur über Pull Requests, die `pnpm verify` bestehen müssen. | Technik (ca. 1 Tag) | Repository vorhanden, Pipeline und Branch-Schutz fehlen |
| 9 | **Erstkonfiguration auf dem Zielsystem.** `pnpm db:seed` ohne `--demo` (Superadmin-Zugang über `SEED_ADMIN_*`), Gebühren/MwSt./Zahlungsfrist, Support-E-Mail und -Telefon (werden Händlern auf der Auktionsseite angezeigt), Hinweistext unter den Auktionen, Logo und Bankverbindung für die PDFs, Händlergruppen, Außendienst-Konten, Kataloge veröffentlichen (nur veröffentlichte erscheinen als Karten auf der Händler-Startseite). | Betreiber | Masken vorhanden |
| 9a | **Speicher für Videos einplanen.** Mit 30 Fahrzeugen je Tag wächst der Objektspeicher um ca. 2,3 TB je Jahr (davon ca. 0,5 TB Videos); Zweitkopie der Fotos und Videos außer Haus einrichten (`12-kosten-und-betrieb.md`). | Betreiber | offen |

## B. Dringend empfohlen vor den ersten echten Auktionen

| # | Punkt | Begründung |
|---|---|---|
| 10 | **Überwachung und Alarm.** `/api/v1/health` meldet Datenbank, Objektspeicher und Auktionstakt („degraded“, wenn der Takt ausbleibt; keine internen Fehlertexte mehr nach außen). Backup-Fehler melden sich per Webhook. Es fehlt: externer Uptime-Monitor auf `/api/v1/health` (alle 60 s) mit Benachrichtigung, Alarm bei „unhealthy“ Containern, zentrale Logs (Container-Logs werden jetzt rotiert, 5 × 10 MB je Dienst). | Ein hängender Auktionstakt würde sonst erst durch Händlerbeschwerden auffallen. |
| 11 | **Zwei-Faktor-Anmeldung für Admin-Konten.** Nicht umgesetzt. | Admin-Konten können Preise, Freigaben und Auszahlungen steuern. |
| 12 | **Passwort zurücksetzen per E-Mail.** Fehlt; derzeit setzt der Admin Passwörter zurück. | Bei 30 Händlern tragbar, aber Supportaufwand. |
| 13 | **Datenschutz-Organisation.** Auftragsverarbeitungsverträge (Hoster, Objektspeicher, E-Mail, Anthropic), Verzeichnis der Verarbeitungstätigkeiten, Löschkonzept für Personendaten (Fahrzeugakten bleiben laut §8 dauerhaft; Nutzer- und Sitzungsdaten brauchen Fristen). Technisch fehlt eine Löschroutine (abgelaufene Sessions, abgelehnte Registrierungen, inaktive Benutzer, Login-Fehlversuche) und ein Konzept für Personendaten im unveränderlichen Audit-Log (Pseudonymisierung statt Löschung). Die optionale Ausweiskopie bei der Registrierung wurde entfernt; bereits hochgeladene `ID_DOCUMENT`-Dateien nach der Freigabe löschen. | gesetzlich erforderlich |
| 14 | **Externer Sicherheitstest.** Eigenes Security-Review liegt vor (`09-security-review.md`); ein unabhängiger Penetrationstest vor dem Livegang ist üblich. | Gebote sind verbindlich, Geld fließt. |
| 15 | **Content-Security-Policy ohne `unsafe-inline`** und **Ratenbegrenzung über mehrere Instanzen** (Redis). | Erst relevant bei Härtung bzw. mehr als einer API-Instanz. |
| 16 | **Außendienst offline härten.** Nach einem Neustart der App ohne Netz hängt die Oberfläche an `/auth/me`; lokale Entwürfe werden nie verworfen und überschreiben den Serverstand; die Upload-Warteschlange kennt keine Abhängigkeiten (schlägt „Fahrzeug anlegen“ fehl, bleiben die Folge-Uploads hängen). Der Funkloch-Test im Staging-Durchlauf zeigt, wie dringend das ist. | 3 bis 4 Tage Technik |
| 17 | **Gebotsregeln klären.** Sofortkauf ignoriert ein aktives, höheres Maximalgebot des Führenden; bei nicht erreichtem Mindestpreis gibt es für den Bieter keine Frist, bis wann der Verkäufer entscheidet; der Verbindlichkeitsdialog erscheint nur beim ersten Gebot je Sitzung. Das sind Geschäftsentscheidungen des Betreibers, die in die Bieterbedingungen gehören und dann im Code abgebildet werden. | 1 bis 2 Tage Technik nach Entscheidung |
| 18 | **Fehlende Komfortfunktionen**, die Händler und Autohäuser vermissen werden: Passwort zurücksetzen per E-Mail, E-Mail-Verifizierung bei der Registrierung, Benachrichtigungseinstellungen (derzeit E-Mail bei jedem Überbieten), CSV-Export von Käufen/Verkäufen/Geboten, Kopfzeilen-Suche für Admin, Autohaus und Außendienst. | 5 bis 7 Tage Technik |
| 19 | **Git-Historie bereinigt.** Das am 02.10.2026 von einem externen Werkzeug eingecheckte Postgres-Datenverzeichnis, Uploads und Test-Zugangsdaten wurden aus der gesamten Historie entfernt und `main` erzwungen neu gepusht. Offen: Forks oder Klone, die den alten Stand noch haben, löschen; GitHub-Support kann zwischengespeicherte Objekte bereinigen. Die Beispiel-Passwörter aus `.env.example` gelten als bekannt; der Seed lehnt sie in staging/production ab. | erledigt bis auf Klone |

## E. Ergebnis der unabhängigen Livegang-Prüfung (02.10.2026)

Sieben Prüfer (Sicherheit, Auktionslogik, Betrieb, Recht/Datenschutz, Funktionsumfang/§64, Testabdeckung, Oberfläche/Mobil) haben nur lesend den Code geprüft; jeder schwere Befund wurde von zwei weiteren Prüfern mit dem Auftrag, ihn zu widerlegen, gegengeprüft. Kein Blocker wurde widerlegt. Was die Prüfung bestätigt hat: Guards und Mandantenfilter auf jeder Route, Gebote in Transaktion mit Zeilensperre und Datenbankuhr, genau ein Gewinner per Unique-Index, neustartfeste Job-Queue und Scheduler, privater Objektspeicher mit Signed URLs, fail-closed Virenscan, Trigger-geschütztes Audit-Log, Statistiken aus SQL-Aggregaten, keine Mock-Daten in Produktionspfaden.

| Befund | Schwere | Stand |
|---|---|---|
| Impressum fehlt | Blocker | Seite und Rechtstext-Art eingebaut; Inhalt vom Betreiber (A5) |
| Platzhalter-Rechtstexte ohne technischen Schutz | Blocker | Sperre für Auktionen in Produktion eingebaut (A4) |
| MinIO und Mailpit mit festen Zugangsdaten im Produktions-Compose, Ports offen | Blocker | behoben: nur noch Profil `dev`, Ports auf 127.0.0.1, Passwort aus `.env` |
| Postgres/MinIO ohne restart-Policy, keine Log-Rotation, Worker dauerhaft „unhealthy“ | hoch | behoben |
| Produktionsstart mit Platzhalterwerten möglich | hoch | behoben: Startprüfung bricht in Produktion ab |
| CSP: Speicher-Adresse im Build nicht gesetzt, `media-src` fehlte (Motorvideo wäre blockiert) | hoch | behoben: Pflichtvariable `CSP_STORAGE_ORIGIN`, `media-src` ergänzt |
| Objektspeicher nicht gesichert, kein Alarmweg, kein Restore-Runbook | hoch | Spiegelung und Webhook eingebaut; Runbook offen (A7, B10) |
| Health-Endpunkt gibt interne Fehlertexte aus | niedrig | behoben |
| Anthropic erhält Fotos, die Halterdaten enthalten können (Fahrzeugschein) | hoch | Prompt und Hinweis geändert; AVV und Datenschutzerklärung (A7a) |
| Optionale Ausweiskopie unbefristet gespeichert | hoch | Upload entfernt; Altbestand löschen (B13) |
| Nachlade-Fehler blendeten vorhandene Daten aus (Auktionsseite, Auftrag) | hoch | behoben |
| Gebührenrechnungen ohne Rechnungsdokument (§ 14 UStG) | hoch | offen (A5a) |
| Kein Löschkonzept, Audit-Log mit Personendaten | hoch | offen (B13) |
| Kein Passwort-Reset, keine 2FA, keine E-Mail-Verifizierung | hoch/mittel | offen (B11, B12, B18) |
| Außendienst-App offline nur eingeschränkt | hoch | offen (B16) |
| Keine CI, kein Branch-Schutz, Historie mit Fremddaten | hoch | Historie bereinigt (B19); CI und Branch-Schutz offen (A8) |
| Zweite externe Prüfung (27 Punkte, 02.10.2026): lokaler Dateispeicher, getrennte Container-Speicher, ungesicherte Dateien, MinIO-Standardzugang, Signier-Secret, fehlende Startprüfung | blocker/hoch | alle behoben (Rückbau auf S3, Compose-Härtung, Startprüfung) |
| Job-Reaper ohne Lebenszeichen, Race beim Abschluss, E-Mail/Push bei Wiederholung doppelt | hoch | behoben (Sperr-Token, Lebenszeichen, Zwischenstände) |
| Upload vor Berechtigungsprüfung, verwaiste Dateien bei Transaktionsabbruch, WebSocket-Zähler und fehlende Drossel | mittel | behoben |
| Backup/PITR bei verwalteter Datenbank zielt auf den Compose-Postgres | hoch | behoben (`DATABASE_URL` hat Vorrang) |
| Caddy veröffentlicht MinIO auch ohne Bedarf | mittel | behoben (eigene Caddyfile nur für MinIO-Betrieb) |
| Sofortkauf vs. Maximalgebot, Mindestpreis-Frist, Verbindlichkeitsdialog | mittel | Entscheidung des Betreibers (B17) |
| Keine Web-Tests, Mindestpreis-Ablehnung/Reklamation nur Happy Path, Rate-Limits ungetestet | mittel | offen, Teststrategie ergänzen |

## C. Bewusst nicht Teil der Beta (§59)

Transportnetzwerk, Bankabwicklung, Treuhandkonto, Mehrwährung, native Apps, KI-Schadensbewertung als verbindlicher Wert, Werkstattkalkulation, europaweite Logistik. Nichts davon ist gebaut; die Architektur lässt es zu. FIN-Erkennung vom Foto und die Prüfung „Fahrzeug vollständig im Bild“ sind inzwischen per KI umgesetzt, bleiben aber Vorschläge, keine verbindlichen Werte.

## D. Können 30 Händler gleichzeitig bieten?

Ja, nachgewiesen auf dem Entwicklungsrechner; die Grenze liegt deutlich höher.

| Nachweis | Aufbau | Ergebnis |
|---|---|---|
| Concurrency-Test | 100 echte Händlerkonten geben im selben Moment je ein Gebot auf **eine** Auktion ab (über HTTP, nicht simuliert) | kein Gebot verloren, genau ein Höchstbietender, Gebotssequenz lückenlos; Ablehnungen nur fachlich („zu niedrig“, „führen bereits“) |
| Concurrency-Test | 50 Händler setzen gleichzeitig Maximalgebote | höchstes Maximum gewinnt zum korrekten Preis, Maxima bleiben geheim |
| Concurrency-Test | Gebote exakt zum Endzeitpunkt, drei Scheduler-Instanzen parallel | kein Gebot nach Ende, genau ein Deal |
| Lasttest | 100 Sitzungen mit WebSocket, 50 Dauerbieter auf 30 Auktionen, 60 s | 2.336 angenommene Gebote, 0 technische Fehler, Live-Anzeige bei allen Beobachtern nach p99 0,8 s, 24 Deals mit 72 PDFs |
| E2E | zwei echte Browser bieten gegeneinander | Überbieten erscheint ohne Neuladen, serverseitiges Ende, Zuschlag |

Warum das trägt: Jedes Gebot läuft in einer Datenbanktransaktion mit Zeilensperre auf der Auktion; der Server entscheidet nach seiner Reihenfolge und seiner Uhr; ein eindeutiger Index lässt nur ein führendes Gebot je Auktion zu; jedes Gebot trägt eine Transaktions-ID und kann gefahrlos wiederholt werden.

Grenzen der Aussage: Gemessen auf einem Laptop mit Datenbank in Docker, nicht auf dem Zielserver und nicht über das öffentliche Internet. Ein Händler darf höchstens 30 Gebote in 10 Sekunden abgeben (Ratenlimit). Beim Testen trat einmal ein stiller Hänger einer Datenbankverbindung auf; seitdem brechen hängende Verbindungen mit Fehler ab, und der Auktionstakt wird überwacht (siehe `10-abnahme.md`).
