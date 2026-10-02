# 09 – Security Review (Beta)

Stand: 02.10.2026. Geprüft gegen Spezifikation §44/§45 sowie OWASP-ASVS-Kernpunkte. Jede Zeile nennt Umsetzung und Nachweis.

## Umgesetzt

| Anforderung | Umsetzung | Nachweis |
|---|---|---|
| Serverseitige Autorisierung bei jedem Request | Guards `requireAuth/requireRoles/requireCompany` je Route (`apps/api/src/core/auth.ts`); Mandantenfilter direkt in den SQL-Abfragen (`vehicleVisibility`, `dealerAuctionVisibility`, `dealVisibility`) | Integrationstests Phase 1–7 |
| RBAC | Plattformrolle + Firmenrolle + Firmentyp + Freigabestatus + Bieterstatus | `phase1-auth-companies.test.ts` (Rollen & Rechte) |
| Mandantentrennung / IDOR | Fremde IDs liefern **404** (Existenz wird nicht verraten). Geprüft: `/vehicles/:id`, `/company…`, `/admin/companies/:id` (nur Admin), `/auctions/:id`, `/deals/:id`, `/documents/:id/file`, `/inspection-requests/:id`, Foto-/Dokument-Downloads, WebSocket-Kanäle | `phase1…`, `phase3…` (IDOR-Blöcke), `phase4-6…` (Deals/Dokumente), Concurrency-Test (WebSocket `FORBIDDEN`), E2E (Verlierer → 404 auf Deal) |
| Vertraulichkeit gegenüber Händlern (§3.3) | Mitbieter erscheinen nur als „Bieter N“ (Gebotsverlauf und Live-Ereignisse), eigene Gebote mit eigenem Firmennamen; Verkäuferidentität, Kennzeichen, Straße und Originalfotos werden Händlern vor dem Zuschlag nicht ausgeliefert; Katalog-Navigation und Katalogname nur aus für den Händler sichtbaren Auktionen; Fragen laufen über den Plattformkontakt | `auction-detail.test.ts`, E2E (Verkäufername erscheint nicht auf der Auktionsseite) |
| Sichere Sessions | 256-Bit-Zufallstoken, in der DB nur als SHA-256-Hash; Cookie `httpOnly`, `SameSite=Lax`, `Secure` (in staging/production beim Start erzwungen); TTL 12 h | `auth.ts`, `config.ts` |
| Session-Invalidierung | Logout, Passwortänderung, Sperrung von Benutzer oder Firma, Rollenänderung beenden alle Sessions; offene WebSockets werden per Realtime-Bus getrennt; gesperrte Firmen werden bei jeder Anfrage abgewiesen | Tests „Passwortänderung beendet alle Sessions“, „Sperrung einer Firma …“ |
| CSRF-Schutz | Origin-Prüfung für alle mutierenden Requests (`ALLOWED_ORIGINS`), Ablehnung von `Sec-Fetch-Site: cross-site`, zusätzlich `SameSite=Lax`; WebSocket-Handshake prüft Origin (CSWSH) | Tests „CSRF-Schutz“, WebSocket-Test (Close-Code 4003) |
| Rate Limits | Global 600/min, Login 20/15 min je IP + 10/15 min je E-Mail, Registrierung 10/h je IP, Gebote 30/10 s je Benutzer, Uploads 300/min | `app.ts`, Routen-Konfiguration |
| Passwort-Hashing | PBKDF2-HMAC-SHA256 mit 600.000 Iterationen und 16-Byte-Salt (OWASP), berechnet im libuv-Threadpool, damit Login-Spitzen keine Gebote verzögern; Vergleich mit `timingSafeEqual`; ältere bcrypt-Hashes werden bei der nächsten Anmeldung ersetzt (im Audit-Log vermerkt); Mindestlänge 10 mit Buchstaben und Ziffern; konstante Laufzeit bei unbekannter E-Mail (Dummy-Hash gegen User-Enumeration) | `passwords.test.ts`, Test „unbekannte E-Mail …“ |
| Upload-Validierung | Dateityp per Magic Bytes (nicht Dateiname), Größenlimit 25 MB im Stream, PDFs mit JavaScript/Launch-Aktionen werden abgelehnt, Bilder müssen decodierbar sein, Ableitungen werden neu codiert (EXIF/GPS entfernt) | Tests „Upload-Validierung“, „lehnt Nicht-Bilder ab“ |
| Malware-Prüfung | clamd-INSTREAM-Client, **fail closed**: nur „stream: OK“ gibt frei; Fehlerantwort, fehlende Antwort, Zeitüberschreitung oder Ausfall sperren den Upload (HTTP 503). Compose-Dienst `clamav` (Profil `app`, lokal Profil `scan`) mit Health-Check; API und Worker starten erst, wenn der Scanner bereit ist | `clamav.test.ts` (nachgebauter Dienst), `clamav-live.test.ts` (echter clamd: EICAR erkannt, saubere Datei frei) |
| Externer KI-Dienst (Bilderkennung) | FIN-Foto und Außenaufnahmen werden zur Erkennung an die Anthropic-API gesendet (TLS, API-Schlüssel nur serverseitig in `ANTHROPIC_API_KEY`); übertragen werden ausschließlich das jeweilige Foto ohne Metadaten und ein fester Prüfauftrag, keine Personen-, Firmen- oder Preisdaten. Antworten sind strukturiert (erzwungenes Werkzeug) und werden validiert; die FIN bleibt ein Vorschlag bis zur Bestätigung durch den Mitarbeiter. Ohne Schlüssel ist die Funktion aus. Datenschutz: Auftragsverarbeitung mit Anthropic vor Livegang klären (Anthropic verwendet API-Daten standardmäßig nicht zum Training) | `ai-vision.test.ts` |
| SQL-Injection | Ausschließlich parametrisierte Drizzle-Abfragen; `sql.raw` nur mit Konstanten (Sequenznamen, Enum-Werte) | Code-Review |
| XSS | React escaped Ausgaben, kein `dangerouslySetInnerHTML`; Rechtstexte als Text gerendert; Content-Security-Policy (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) | `next.config.mjs` |
| Clickjacking / Header | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; API mit Helmet; HSTS über Caddy | `next.config.mjs`, `infra/Caddyfile` |
| Open Redirect | `next`-Parameter beim Login nur für interne Pfade | `login/page.tsx` |
| Dateispeicher | Privater Bucket ohne anonyme Policy, nicht vorhersehbare Objektschlüssel, Zugriff nur nach Autorisierung über 5-Minuten-Signed-URLs; Käufer erhalten nie Originalfotos | `storage.ts`, Foto-Route |
| Audit-Log unveränderbar | DB-Trigger verbieten UPDATE/DELETE/TRUNCATE; alle Admin-Aktionen, Logins, Gebote, Statuswechsel protokolliert; Geheimnisse werden aus Audit-Werten entfernt | Test „Audit-Log ist unveränderlich“ |
| Datenintegrität | Gebote, Deals (Kernfelder), PDF-Versionen, OBD-Codes, Revisionen per Trigger unveränderlich; Fahrzeugakten nicht löschbar | Tests in Phase 3 und 4–6 |
| Fehlerbehandlung | Keine Stacktraces an Clients; Cookies/Authorization in Logs geschwärzt | `app.ts` |
| Keine stillen Hänger (§50) | Datenbank-Pool mit Verbindungs- und Abfrage-Zeitlimit, serverseitigem `statement_timeout`, `idle_in_transaction_session_timeout` und TCP-Keepalive: eine abgerissene oder hängende Verbindung bricht mit Fehler ab (Gebote sind idempotent wiederholbar); der Auktionstakt meldet überlange Takte im Protokoll, Health-Endpunkt und Admin-Systemstatus zeigen den letzten erfolgreichen Takt und melden „degraded“, wenn er ausbleibt | `client.ts`, `scheduler.ts`, `/health` |
| Abhängigkeiten | `pnpm audit --prod`: keine bekannten Schwachstellen (PostCSS per Override auf gepatchte Version) | `package.json` (`pnpm.overrides`) |
| Build-Kontext | `.dockerignore` schließt `.env`-Dateien, `node_modules`, Build-Ordner, Backups und Testartefakte aus; Images enthalten nur die gebauten Artefakte, Laufzeit als Benutzer `node` | Probe-Build beider Images |

## Offene Punkte (bewusst nicht als erledigt deklariert)

1. **Virenscanner:** umgesetzt und live getestet (Compose-Dienst `clamav`); in `infra/env/*.env.example` ist `CLAMAV_HOST=clamav` gesetzt. Beim ersten Start lädt der Dienst einige Minuten Signaturen; bis dahin sind Uploads gesperrt (fail closed).
2. **Ratenbegrenzung ist instanzlokal** (In-Memory). Bei mehreren API-Instanzen gilt das Limit je Instanz; für horizontale Skalierung Redis-Store für `@fastify/rate-limit` ergänzen.
3. **CSP erlaubt `'unsafe-inline'` für Skripte**, weil Next.js ohne Nonce-Middleware Inline-Skripte zur Hydration benötigt. Härtung über Nonce-basierte CSP möglich.
4. **Zwei-Faktor-Authentisierung** ist nicht Teil der Beta-Anforderungen und nicht umgesetzt; für Admin-Konten empfohlen.
5. **Passwort-Zurücksetzen per E-Mail** fehlt; Passwörter setzt derzeit der Administrator zurück (alle Sessions werden dabei beendet).
6. **Rechtstexte und Zahlungsinformationen** sind als Vorlagen gekennzeichnet und müssen vor Livegang ersetzt werden (Spec §61).
7. **Kartenansicht/Umkreissuche** basieren auf PLZ-Regionszentren (Genauigkeit ca. 20–50 km), um keinen externen Geocoding-Dienst einzubinden.
