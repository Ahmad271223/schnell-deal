# 11 – Was bis zum Livegang noch fehlt

Stand 02.10.2026. Die Beta erfüllt 21 von 22 Punkten der Definition of Done (§63) automatisiert nachgewiesen; offen ist der Staging-Durchlauf auf echter Infrastruktur (`10-abnahme.md`). Diese Liste nennt alles, was zwischen „Beta auf dem Entwicklungsrechner“ und „Händler bieten echtes Geld“ liegt. Reihenfolge = empfohlene Reihenfolge.

## A. Ohne das kein Livegang (Blocker)

| # | Punkt | Wer | Stand |
|---|---|---|---|
| 1 | **Server und Domain.** Linux-Server (empfohlen: 4 vCPU, 8 GB RAM, 100 GB SSD) mit Docker, Domain mit DNS-Einträgen für `auktion.<domain>` und `storage.<domain>`. Caddy holt TLS-Zertifikate automatisch (`infra/Caddyfile`). | Betreiber | offen |
| 2 | **Produktions-Konfiguration.** `infra/env/production.env` aus der Vorlage anlegen: eigene S3-Schlüssel, SMTP-Zugang (derzeit Platzhalter `ersetzen`), `MAIL_FROM` mit eigener Domain, `ANTHROPIC_API_KEY` für die KI-Bilderkennung, Zugangsdaten für die Kopie außer Haus (`OFFSITE_REMOTE`, `RCLONE_CONFIG_OFFSITE_*`), optional VAPID-Schlüssel für Push. Datenbank-Passwort in einer `.env` neben `docker-compose.yml` (`POSTGRES_PASSWORD`, muss zur `DATABASE_URL` passen). Dateien nie ins Repository. | Betreiber + Technik | Vorlagen vorhanden |
| 3 | **Staging-Durchlauf (DoD 22).** Kompletter Ablauf auf dem Staging-Server mit echten Geräten: Außendienst-Smartphone (Kamera, 28 Fotos, Funkloch-Test), Admin am Desktop, zwei Händler-Browser, echter E-Mail-Empfang, PDF-Download, Abholcode. Protokoll in `10-abnahme.md` ergänzen. | Technik + 1 Pilot-Autohaus + 2 Pilot-Händler | offen |
| 4 | **Rechtstexte.** AGB, Bieterbedingungen, Datenschutzerklärung, Kaufvertrags-/PDF-Texte und Zahlungsinformationen sind gekennzeichnete Vorlagen (§61). Juristisch geprüfte Fassungen unter Einstellungen → Rechtstexte als neue Version veröffentlichen; jede Zustimmung wird je Version protokolliert (§60). | Anwalt + Betreiber | Vorlagen vorhanden |
| 5 | **Impressum.** Eine Impressumsseite gibt es noch nicht (Pflicht nach § 5 DDG). Umsetzung: als weiterer Rechtstext-Typ ohne Zustimmungspflicht, öffentlich verlinkt. | Technik (ca. 1 Tag) + Betreiber (Inhalt) | fehlt |
| 6 | **Virenscanner.** Compose-Dienst `clamav` ist eingebaut und live getestet; `CLAMAV_HOST=clamav` steht in den Vorlagen. Beim ersten Start lädt der Dienst einige Minuten Signaturen, API und Worker warten darauf. | Technik | erledigt |
| 7 | **Backups.** Täglicher Dump, WAL-Archivierung, wöchentliche Basissicherung, Zeitpunkt-Wiederherstellung getestet, Kopie außer Haus per rclone getestet. Offen: Zielspeicher außer Haus beauftragen und die Zugangsdaten eintragen; Wiederherstellung einmal auf dem Zielserver proben. | Betreiber + Technik | technisch fertig, Speicher fehlt |
| 7a | **Auftragsverarbeitung KI.** Für die FIN-Erkennung und die Bildprüfung werden Fotos an Anthropic übertragen. Vor dem Livegang Auftragsverarbeitungsvertrag abschließen und in der Datenschutzerklärung nennen; ohne Schlüssel bleibt die Funktion aus. | Betreiber | offen |
| 8 | **Versionsverwaltung und CI.** Das Projekt hat noch keinen Git-Commit und keine Pipeline. Vor Livegang: Repository mit erstem Commit, Pipeline, die `pnpm verify` und `pnpm test:e2e` bei jeder Änderung ausführt, Images baut und auf Staging ausrollt. | Technik (ca. 1 Tag) | fehlt |
| 9 | **Erstkonfiguration auf dem Zielsystem.** `pnpm db:seed` ohne `--demo` (Superadmin-Zugang über `SEED_ADMIN_*`), Gebühren/MwSt./Zahlungsfrist, Support-E-Mail und -Telefon (werden Händlern auf der Auktionsseite angezeigt), Händlergruppen, Außendienst-Konten. | Betreiber | Masken vorhanden |

## B. Dringend empfohlen vor den ersten echten Auktionen

| # | Punkt | Begründung |
|---|---|---|
| 10 | **Überwachung und Alarm.** `/api/v1/health` meldet Datenbank, Objektspeicher und Auktionstakt („degraded“, wenn der Takt ausbleibt). Ein externer Uptime-Monitor (z. B. alle 60 s) mit Benachrichtigung an den Betreiber fehlt noch; ebenso zentrale Logs. | Ein hängender Auktionstakt würde sonst erst durch Händlerbeschwerden auffallen. |
| 11 | **Zwei-Faktor-Anmeldung für Admin-Konten.** Nicht umgesetzt. | Admin-Konten können Preise, Freigaben und Auszahlungen steuern. |
| 12 | **Passwort zurücksetzen per E-Mail.** Fehlt; derzeit setzt der Admin Passwörter zurück. | Bei 30 Händlern tragbar, aber Supportaufwand. |
| 13 | **Datenschutz-Organisation.** Auftragsverarbeitungsvertrag mit dem Hoster, Verzeichnis der Verarbeitungstätigkeiten, Löschkonzept für Personendaten (Fahrzeugakten bleiben laut §8 dauerhaft; Nutzer- und Sitzungsdaten brauchen Fristen). Technisch fehlt eine Löschroutine für inaktive Personendaten. | gesetzlich erforderlich |
| 14 | **Externer Sicherheitstest.** Eigenes Security-Review liegt vor (`09-security-review.md`); ein unabhängiger Penetrationstest vor dem Livegang ist üblich. | Gebote sind verbindlich, Geld fließt. |
| 15 | **Content-Security-Policy ohne `unsafe-inline`** und **Ratenbegrenzung über mehrere Instanzen** (Redis). | Erst relevant bei Härtung bzw. mehr als einer API-Instanz. |

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
