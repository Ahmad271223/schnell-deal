# 03 – Rollen- und Berechtigungsmatrix

## Rollenmodell

* **Plattformrolle** (`users.platform_role`): `SUPERADMIN`, `ADMIN`, `INSPECTOR`, `USER`.
* **Firmenrolle** (`company_users.company_role`): `OWNER`, `MANAGER`, `MEMBER` – nur für `USER`.
* **Firmentyp** (`companies.type`): `DEALERSHIP` (Autohaus/Einlieferer), `DEALER` (Händler/Käufer).
* **Freigabestatus**: `companies.status = APPROVED` ist Voraussetzung für jede fachliche Aktion; `dealer_verifications.bidding_status = CAN_BID` zusätzlich für Gebote.

Jeder Request durchläuft serverseitig: Session → User aktiv? → Plattformrolle → Firmenkontext (Mandant) → Objekt-Ownership (IDOR-Schutz). Frontend-Sichtbarkeit ist nur Komfort.

## Matrix

Legende: ✅ erlaubt · 🔒 nur eigene Firma/eigene Objekte · ❌ verboten · (O) nur OWNER/MANAGER der Firma

| Aktion | SUPERADMIN | ADMIN | INSPECTOR | Autohaus-User | Händler-User |
|---|---|---|---|---|---|
| Benutzer anlegen/sperren (plattformweit) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Admin-Benutzer anlegen | ✅ | ❌ | ❌ | ❌ | ❌ |
| Firma freigeben/ablehnen/sperren, Gewerbenachweis prüfen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Händler-Bieterstatus setzen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Firmendaten pflegen | ✅ | ✅ | ❌ | 🔒 (O) | 🔒 (O) |
| Firmenmitarbeiter verwalten | ✅ | ✅ | ❌ | 🔒 (O) | 🔒 (O) |
| Firmendokumente hochladen | ✅ | ✅ | ❌ | 🔒 (O) | 🔒 (O) |
| Aufnahmeanfrage erstellen | ✅ | ✅ | ❌ | 🔒 | ❌ |
| Aufnahmeanfragen sehen | ✅ alle | ✅ alle | 🔒 zugewiesene | 🔒 eigene | ❌ |
| Disposition (Mitarbeiter zuweisen, Termin) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auftragsstatus EN_ROUTE/ON_SITE/IN_PROGRESS setzen | ✅ | ✅ | 🔒 zugewiesene | ❌ | ❌ |
| Fahrzeug anlegen/Aufnahme durchführen | ✅ | ✅ | 🔒 im eigenen Auftrag | ❌ | ❌ |
| Fahrzeugaufnahme abschließen (sperren) | ✅ | ✅ | 🔒 | ❌ | ❌ |
| Fahrzeug nach Sperrung korrigieren (Revision) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Fahrzeug prüfen: freigeben / zurückweisen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Fahrzeugdokumente für Käufer freigeben | ✅ | ✅ | ❌ | ❌ | ❌ |
| Eigene Fahrzeuge sehen (Akte, ohne interne Notizen) | ✅ | ✅ | 🔒 eigene Aufnahmen | 🔒 | ❌ |
| Interne Notizen/Kommentare sehen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Katalog/Händlergruppe erstellen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auktion anlegen/parametrisieren/planen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auktion stoppen (nur ohne Zuschlag) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auktion Endzeit ändern | ✅ | ✅ | ❌ | ❌ | ❌ |
| Auktionsliste/Details sehen | ✅ | ✅ | ❌ | 🔒 eigene Fahrzeuge | ✅ freigegebene (Händlergruppe) |
| Mindestpreis sehen | ✅ | ✅ | ❌ | 🔒 eigene | nur wenn `reserve_visible` |
| Gebot abgeben / Maximalgebot setzen | ❌ | ❌ | ❌ | ❌ | ✅ wenn `CAN_BID` + Bieterbedingungen akzeptiert |
| Bieteridentität sehen | ✅ | ✅ | ❌ | ❌ | ❌ (nur anonymisiert „Bieter 3“) |
| Eigene Gebote/Höchstgebote sehen | – | – | – | – | 🔒 |
| Favoriten | – | – | – | – | 🔒 |
| Deals sehen | ✅ | ✅ | ❌ | 🔒 als Verkäufer | 🔒 als Käufer |
| Deal-Status ändern (Zahlung, Abholung geplant) | ✅ | ✅ | ❌ | ❌ | ❌ |
| „Fahrzeug übergeben“ bestätigen | ✅ | ✅ | ❌ | 🔒 | ❌ |
| „Fahrzeug übernommen“ bestätigen | ✅ | ✅ | ❌ | ❌ | 🔒 |
| PDFs herunterladen | ✅ alle | ✅ alle | ❌ | 🔒 Verkäufer-PDF | 🔒 Käufer-PDF |
| PDFs neu erzeugen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Reklamation eröffnen | ✅ | ✅ | ❌ | ❌ | 🔒 eigene Deals |
| Reklamation bearbeiten | ✅ | ✅ | ❌ | ❌ | ❌ |
| Statistiken Plattform | ✅ | ✅ | ❌ | ❌ | ❌ |
| Statistiken eigene Firma | ✅ | ✅ | ❌ | 🔒 | 🔒 |
| Mitarbeiter-Statistik | ✅ | ✅ | 🔒 eigene | ❌ | ❌ |
| Audit-Log lesen | ✅ | ✅ | ❌ | ❌ | ❌ |
| Rechtstexte versionieren | ✅ | ✅ | ❌ | ❌ | ❌ |
| Plattform-Einstellungen (Gebühren etc.) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Benachrichtigungen (eigene) | ✅ | ✅ | ✅ | ✅ | ✅ |

## Datensichtbarkeit Händler (Auktionsansicht)

Sichtbar: Fahrzeugdaten, Fotos (Web-Version), Schäden, Lackmessung, Reifen, Diagnosecodes, freigegebene Dokumente, aktuelles Gebot, Gebotsanzahl, Restzeit, eigener Status („Sie führen“ / „Überboten“), Mindestpreis nur wenn `reserve_visible`.

Nie sichtbar: Einlieferer-Firmenname bis Zuschlag (nur Standort PLZ/Ort), andere Bieteridentitäten, Maximalgebote anderer, interne Kommentare, Mitarbeiterdaten, nicht freigegebene Dokumente (Zulassungsbescheinigung II etc.).

## Technische Umsetzung

* `requireAuth()` – Session gültig, User aktiv, Firma nicht `BLOCKED`.
* `requireRole(...roles)` – Plattformrolle.
* `requireCompanyType(type)` – `DEALERSHIP`/`DEALER` mit `status = APPROVED`.
* `requireCompanyRole('OWNER','MANAGER')` – Firmenrolle.
* `requireBidder()` – Händler + `CAN_BID` + aktuelle Bieterbedingungen akzeptiert.
* Jede Query auf Firmenobjekte enthält `WHERE company_id = ctx.companyId` (kein nachgelagertes Filtern im Code). Admin-Queries verzichten darauf explizit.
* Integrationstests: jede `/:id`-Route mit fremder ID → `404` (nicht `403`, um Existenz nicht zu verraten).
