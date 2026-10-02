# 08 – Teststrategie

| Ebene | Werkzeug | Ort | Umfang |
|---|---|---|---|
| Unit | Vitest | `packages/shared/src/__tests__` | Zustandsmaschinen, FIN-Prüfziffer, Gebotsauflösung inkl. Bietagent (500 Zufallsfälle), Anti-Sniping, Ergebnis/Reserve, Gebühren/MwSt., Vollständigkeit, Lackwert-Markierung, Bildqualität |
| Integration | Vitest + Fastify `inject` + echte Postgres-Testdatenbank (`schnelldeal_test`, wird je Lauf neu migriert) + MinIO | `apps/api/test/*.test.ts` | Alle Kernrouten, Rollen, Mandantentrennung, Audit-Einträge, DB-Trigger (append-only/unveränderlich), PDF-Erzeugung und -Versionierung, Statistiken mit bekannten Fixture-Werten; Auktionsdetail für Händler (Katalog-Navigation nur über sichtbare Auktionen, Kontakt, Vertraulichkeit des Verkäufers, Katalogfilter); Job-Queue (Prioritäten, Abarbeitung eines Rückstaus); Passwort-Hashing (PBKDF2, Umstellung alter bcrypt-Hashes); Virenscanner-Client gegen nachgebauten clamd (fail closed) |
| Medien | Integration | `apps/api/test/media.test.ts` | Motorvideo: Außendienst nur für die eigene, nicht gesperrte Akte; fremder Außendienst 404; Magic-Byte-Prüfung (PDF als .mp4 → 415), leere Datei, Größenlimit unabhängig vom Fotolimit; nach Abschluss nur Admin; Händler nur über sichtbare Auktion, nach dem Ende nur Mitbieter; Admin-Fotonachreichung (erstes Foto = Kartenbild, Qualitätsprüfung bleibt aktiv, Löschen blendet aus) |
| Job-Queue | Integration | `apps/api/test/jobs.test.ts` | Prioritäten, Rückstau ohne Wartezeit, Sperr-Token (ein vom Reaper neu vergebener Job kann vom alten Lauf nicht mehr abgeschlossen werden), Zwischenstände für Wiederholungen |
| Benachrichtigungs-Jobs | Integration | `apps/api/test/notification-jobs.test.ts` | E-Mail: Wiederholung nach sauberem SMTP-Fehler, kein Doppelversand nach Abbruch mitten im Versand (UNCERTAIN); Push: je Abonnement genau einmal über Wiederholungen hinweg |
| Architekturregeln | statisch | `apps/api/test/architecture.test.ts` | Keine HTTP-Antwort aus einer offenen Datenbanktransaktion |
| Livegang-Schutz | Integration | `apps/api/test/legal-readiness.test.ts` | Vorlagen-Rechtstexte inkl. Impressum erkannt, Sperre für Auktionen nur bei erzwungener Prüfung, Startprüfung auf Platzhalterwerte |
| Händler-Startseite | Integration | `apps/api/test/dealer-home.test.ts` | Kennzahlen je Händler (führend, überboten, beobachtet exakt; globale Zähler als Untergrenze, weil die Testdatenbank geteilt ist); Kataloge nur veröffentlicht und mit sichtbaren Auktionen, Zahlen und Titelbild aus genau diesen; Hinweistext des Betreibers |
| IDOR | Integration | in den Phase-Tests | Fremder Mandant erhält 404 für Fahrzeuge, Unternehmen, Aufnahmeaufträge, Auktionen, Deals, Dokumente, Fotos, WebSocket-Kanäle |
| Concurrency | Vitest gegen echten HTTP-Server mit parallelen Verbindungen | `apps/api/test/concurrency` | 100 gleichzeitige Gebote (keine verlorenen Gebote, genau ein Führender, lückenlose Sequenz); Spec-Beispiel A 10.100 €/B 10.200 € parallel (20×); 50 parallele Maximalgebote; Gebote zum Endzeitpunkt mit 3 parallelen Schedulern (kein Gebot nach Ende, genau ein Deal); 30 Auktionen mit identischer Endzeit; WebSocket-Zustellung < 1 s und Kanal-Autorisierung |
| E2E | Playwright (Chromium) gegen Produktions-Build und eigene API/DB | `e2e/tests/full-flow.spec.ts` | Registrierung Autohaus (UI) → Admin-Freigabe → Meldung → Mitarbeiter anlegen und disponieren → mobile geführte Aufnahme mit 28 Fotos, Schaden, Lack, Reifen, Funktionen, Schadstoffklasse, Halter, Ausstattung, Motorvideo → Abschluss → Admin-Prüfung (inkl. Motorvideo-Reiter) → Auktion im veröffentlichten Katalog → Händler-Startseite (Kennzahlen, Katalog-Reihe, Reihe „Neu eingestellt“ führt zur Auktion) → Auktionsseite (LIVE-Galerie, Medien-Umschalter mit Zustandsbildern und Motorvideo, Eckdaten, One-Pager mit Zustandskacheln, Schadenreitern mit Detailfoto, Reifen, Dokumentenstatus, Karte, Favorit, Verkäufer verborgen) → 2 Händler bieten live (WebSocket, „Jetzt … € bieten“, anonymer Gebotsverlauf) → Endzeit-Änderung → serverseitiges Ende → Deal → PDF-Download → Zahlung → Abholung mit Code → Statistik → Audit-Log. Die Testserver laufen unter `e2e/scripts/serve.mjs`, das ein unerwartetes Prozessende protokolliert und den Server neu startet. |
| Last | Node-Skript | `apps/api/src/scripts/loadtest.ts` | API als eigener Prozess (mit Worker), Lastgenerator getrennt: 100 Sitzungen mit WebSocket, 50 Bieter auf 30 Auktionen (60 s), 20 × 8 MB Uploads, 30 gleichzeitige Auktionsenden mit 3 Schedulern; Live-Latenz ohne Uhrenvergleich (Zuordnung über Auktion + Gebotszähler); Invarianten plus Plausibilität (es wurde tatsächlich geboten und verkauft); Ablehnungsgründe; Bericht in `docs/lasttest-ergebnis.md` |
| Backup | Bash + Docker | `scripts/backup.sh`, `scripts/restore-test.sh`, `scripts/pitr-restore-test.sh` | Dump erzeugen, Prüfsumme, Restore in leere DB, Zeilenzahlen und Schutz-Trigger vergleichen; Point-in-Time-Recovery: Basissicherung + WAL-Archiv in einen Wegwerf-Container bis Zeitpunkt T zurückspielen und prüfen, dass spätere Änderungen fehlen; Kopie außer Haus per rclone gegen einen S3-kompatiblen Bucket |
| KI-Bilderkennung | Vitest mit ausgetauschtem Transport | `apps/api/test/ai-vision.test.ts` | FIN-Normalisierung, Anfrageaufbau (JPEG, erzwungenes Werkzeug), nicht lesbare FIN, Route mit Datei und mit gespeichertem Foto, IDOR, abgeschnittene Außenaufnahme → `CROPPED` und fehlendes Pflichtfoto, Dienstausfall ohne Jobfehler, Abschaltung |
| Virenscanner live | Vitest gegen echten clamd (nur mit `CLAMAV_HOST`) | `apps/api/test/clamav-live.test.ts` | EICAR erkannt, saubere Datei frei, Upload-Validierung mit Scanner |

## Ausführen

Voraussetzung: `docker compose up -d postgres minio minio-init mailpit`

```bash
pnpm verify
```

```bash
pnpm test:e2e
```

```bash
pnpm loadtest
```

```bash
pnpm backup && pnpm restore-test
```

`pnpm verify` führt Typecheck, Lint, Unit-, Integrations- und Concurrency-Tests nacheinander aus.
