# Lasttest-Ergebnis

Durchgeführt: 2026-10-02T10:20:16.857Z bis 2026-10-02T10:21:49.585Z · Rechner: win32 / Node v24.15.0.
Aufbau: eine API-Instanz als eigener Prozess mit eingebettetem Worker; Lastgenerator, Postgres und MinIO (beide in Docker) auf demselben Rechner.

**Gesamtergebnis: bestanden**

## Szenario

| Parameter | Wert |
|---|---|
| Eingeloggte Benutzer mit WebSocket | 100 (verbunden: 100) |
| Gleichzeitige Bieter | 50 |
| Aktive Auktionen | 30 |
| Dauer Bietphase | 60 s |
| Große Uploads | 20 × 7.9 MB parallel |
| Auktionen mit identischer Endzeit | 30 (3 parallele Scheduler) |

## Ergebnisse

| Messung | Wert |
|---|---|
| Phase 1: Logins + WebSocket-Verbindungen | 6.2 s |
| Gebote angenommen / fachlich abgelehnt (z. B. überboten) | 2336 / 1602 |
| Gespeicherte Gebotsdatensätze (inkl. Bietagent) | 3761 |
| WebSocket-Ereignisse zugestellt (davon einem Gebot zugeordnet) | 77441 (77441) |
| Live-Aktualisierung: Gebot abgeschickt bis Anzeige bei beobachtenden Bietern, p50 / p95 / p99 | 394 / 630 / 799 ms |
| Phase 3: 20 Uploads parallel (gesamt) | 2.9 s |
| Web-Versionen und Vorschaubilder fertig (nach Upload-Ende) | 7.4 s |
| Phase 4: 30 Auktionsenden inkl. Deals | 3.26 s |
| Deal-PDFs fertig (nach Auktionsende) | 0.2 s |
| E-Mail-Benachrichtigungen versendet / bei Testende noch in der Warteschlange | 1572 / 0 |

### Antwortzeiten je Endpunkt

| Endpunkt | Anzahl | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| GET /auctions/:id/state | 3938 | 185 ms | 283 ms | 1138 ms | 1212 ms |
| POST /auctions/:id/bids | 3329 | 368 ms | 581 ms | 791 ms | 1365 ms |
| POST /auth/login | 101 | 2646 ms | 4745 ms | 4928 ms | 5033 ms |
| POST /vehicles/:id/photos (8 MB) | 20 | 2501 ms | 2805 ms | 2805 ms | 2805 ms |
| PUT /auctions/:id/max-bid | 609 | 445 ms | 724 ms | 970 ms | 1638 ms |

### Abgelehnte Gebote nach Grund

| Grund | Anzahl |
|---|---|
| BID_TOO_LOW | 1551 |
| ALREADY_LEADING | 47 |
| MAX_TOO_LOW | 4 |

### Fehler

Keine technischen Fehler.

## Invarianten

| Prüfung | Ergebnis | Detail |
|---|---|---|
| Höchstens ein führendes Gebot je Auktion | bestanden | 0 Verstöße |
| Gebotssequenzen lückenlos | bestanden | 0 Auktionen mit Lücken |
| Aktuelles Gebot = höchstes gespeichertes Gebot | bestanden | 0 Abweichungen |
| Keine Gebote nach Auktionsende | bestanden | 0 späte Gebote |
| Höchstens ein Deal je Auktion | bestanden | 0 Verstöße |
| Jede verkaufte Auktion hat genau einen Deal | bestanden | 24 verkauft, 24 Deals |
| Deal entspricht dem Höchstgebot | bestanden | 0 Abweichungen |
| Kein Verkauf unter Mindestpreis | bestanden | 0 Verstöße |
| PDFs für alle Deals erzeugt (3 je Deal) | bestanden | 72 Dokumente für 24 Deals |
| Alle großen Uploads verarbeitet (Web/Thumb) | bestanden | 20/20 |
| Bietphase hat Gebote erzeugt | bestanden | 2336 angenommene Anfragen, 3761 Gebotsdatensätze |
| Jede Auktion mit Geboten und ohne Mindestpreis wurde verkauft | bestanden | 24 verkauft, 24 erwartet |
| Live-Ereignisse kamen bei beobachtenden Bietern an | bestanden | 77441 zugeordnete Ereignisse |

Hinweis: Ratenbegrenzung war deaktiviert, da alle simulierten Clients von einer IP kommen. Im Betrieb gelten Limits je Benutzer (z. B. 30 Gebote / 10 s).
