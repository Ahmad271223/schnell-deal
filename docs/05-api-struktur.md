# 05 – API-Struktur

Basis: `/api/v1`. JSON. Fehlerformat: `{ error: { code, message, details? } }`. Alle Zeiten ISO-8601 UTC; jede Antwort enthält Header `X-Server-Time`. Beträge in Cent.

Auth: Session-Cookie `sd_session` (httpOnly, Secure in prod, SameSite=Lax). Mutierende Requests prüfen `Origin`/`Sec-Fetch-Site`. Rate-Limits: Login 10/15min/IP, Gebote 20/10s/User, Uploads 120/min/User, global 600/min/IP.

## Auth & Account
| Methode | Pfad | Rolle | Zweck |
|---|---|---|---|
| POST | /auth/login | – | Login (E-Mail, Passwort) |
| POST | /auth/logout | auth | Session invalidieren |
| GET | /auth/me | auth | Benutzer, Firma, Rollen, offene Rechtstext-Zustimmungen |
| POST | /auth/password | auth | Passwort ändern |
| POST | /auth/accept-legal | auth | Zustimmung zu Rechtstext-Version(en) |
| GET | /legal/current | – | aktive Rechtstexte |

## Registrierung
| POST | /register/dealership | – | Autohaus registrieren (Firma + Erstbenutzer) |
| POST | /register/dealer | – | Händler registrieren |
| POST | /register/documents | auth (eigene Firma) | Gewerbenachweis etc. hochladen (multipart) |

## Firma (eigene)
| GET/PATCH | /company | Firmen-User | Firmendaten |
| GET/POST | /company/users | OWNER/MANAGER | Mitarbeiter listen/anlegen |
| PATCH/DELETE | /company/users/:id | OWNER/MANAGER | bearbeiten/deaktivieren |
| GET/POST | /company/documents | OWNER/MANAGER | Dokumente |
| GET | /company/stats | Firmen-User | Firmenstatistik (§40/§41) |

## Admin – Stammdaten
| GET | /admin/companies?type&status&q | ADMIN | Liste |
| GET | /admin/companies/:id | ADMIN | Detail inkl. Dokumente, Benutzer |
| POST | /admin/companies | ADMIN | manuell anlegen |
| PATCH | /admin/companies/:id | ADMIN | Daten ändern |
| POST | /admin/companies/:id/status | ADMIN | approve/reject/block/request-documents |
| POST | /admin/companies/:id/bidding-status | ADMIN | Händler-Bieterstatus |
| GET | /admin/companies/:id/documents/:docId/url | ADMIN | Signed URL |
| GET/POST | /admin/users | ADMIN | Benutzer (inkl. Inspektoren) |
| PATCH | /admin/users/:id | ADMIN | aktiv/sperren/Rolle/Passwort-Reset |
| GET/POST | /admin/dealer-groups | ADMIN | Händlergruppen |
| PATCH/DELETE | /admin/dealer-groups/:id | ADMIN | |
| PUT | /admin/dealer-groups/:id/members | ADMIN | Mitglieder setzen |
| GET/PUT | /admin/settings | SUPERADMIN | Plattform-Einstellungen |
| GET/POST | /admin/legal | ADMIN | Rechtstexte versionieren |
| GET | /admin/audit?entityType&entityId&event&from&to | ADMIN | Audit-Log |

## Aufnahmeanfragen & Disposition
| POST | /inspection-requests | Autohaus | anlegen |
| GET | /inspection-requests | Autohaus (eigene) / ADMIN (alle) / INSPECTOR (zugewiesene) | Liste mit Filter `status, from, to, view=today|tomorrow|week|unplanned|done|cancelled` |
| GET | /inspection-requests/:id | wie oben | Detail |
| POST | /inspection-requests/:id/cancel | Autohaus (NEW/PLANNED) / ADMIN | |
| POST | /admin/inspection-requests/:id/schedule | ADMIN | Termin setzen |
| POST | /admin/inspection-requests/:id/assign | ADMIN | Mitarbeiter zuweisen (+Termin) |
| POST | /admin/inspection-requests/:id/unassign | ADMIN | |
| GET | /admin/dispatch?from&to | ADMIN | Dispositions-Board (Anfragen + Mitarbeiter) |
| POST | /inspector/requests/:id/status | INSPECTOR | EN_ROUTE / ON_SITE / IN_PROGRESS / COMPLETED |
| GET | /inspector/today | INSPECTOR | heutige Termine |

## Fahrzeuge
| POST | /inspector/requests/:id/vehicles | INSPECTOR | Fahrzeug anlegen (gibt Fahrzeug-ID) |
| GET | /vehicles | ADMIN/Autohaus(eigene)/INSPECTOR(eigene) | Liste mit Filtern |
| GET | /vehicles/:id | berechtigt | Akte (gefiltert nach Rolle) |
| PATCH | /vehicles/:id | INSPECTOR (nicht gesperrt) / ADMIN (als Revision mit `reason`) | Stammdaten |
| POST | /vehicles/:id/vin | INSPECTOR | VIN setzen + validieren (Dubletten-Check) |
| POST | /vehicles/:id/photos/presign | INSPECTOR | Upload-Ziel für Slot anfordern (`clientUploadId`) |
| POST | /vehicles/:id/photos/:photoId/complete | INSPECTOR | Upload bestätigen → Verarbeitung |
| POST | /vehicles/:id/photos (multipart) | INSPECTOR | Direkt-Upload-Alternative (kleine Dateien / Fallback) |
| DELETE | /vehicles/:id/photos/:photoId | INSPECTOR (nicht gesperrt) | ersetzt Foto (Original bleibt, Flag `replaced_by`) |
| GET | /vehicles/:id/photos/:photoId/url?variant=web|thumb|original | berechtigt | Signed URL |
| POST | /vehicles/:id/documents | INSPECTOR/ADMIN | Dokument hochladen |
| POST | /admin/vehicles/:id/documents/:docId/release | ADMIN | Käufer-Sichtbarkeit |
| PUT | /vehicles/:id/damages | INSPECTOR | Schäden ersetzen/anlegen |
| POST | /vehicles/:id/damages | INSPECTOR | Schaden hinzufügen |
| PATCH/DELETE | /vehicles/:id/damages/:damageId | INSPECTOR | |
| PUT | /vehicles/:id/paint | INSPECTOR | 11 Messpunkte |
| PUT | /vehicles/:id/tires | INSPECTOR | 4 Reifen |
| PUT | /vehicles/:id/pdr | INSPECTOR | Dellenprüfung |
| POST | /vehicles/:id/diagnostics | INSPECTOR | OBD-Report (append-only) |
| PUT | /vehicles/:id/battery | INSPECTOR | |
| PUT | /vehicles/:id/features | INSPECTOR | Funktionsprüfung |
| GET | /vehicles/:id/completeness | INSPECTOR/ADMIN | fehlende Pflichtpunkte, % |
| POST | /vehicles/:id/complete | INSPECTOR | Aufnahme abschließen → WAITING_REVIEW |
| GET | /admin/review-queue | ADMIN | Fahrzeuge WAITING_REVIEW |
| POST | /admin/vehicles/:id/review | ADMIN | approve / return (Grund, Zusatzfotos) |
| POST | /admin/vehicles/:id/comments | ADMIN | interner Kommentar |
| GET | /vehicles/:id/revisions | ADMIN | Korrekturhistorie |

## Kataloge & Auktionen (Admin)
| GET/POST | /admin/catalogs | ADMIN | |
| GET/PATCH/DELETE | /admin/catalogs/:id | ADMIN | |
| PUT | /admin/catalogs/:id/vehicles | ADMIN | Fahrzeuge + Sortierung |
| POST | /admin/catalogs/:id/publish | ADMIN | |
| GET/POST | /admin/auctions | ADMIN | Liste / Auktion (Entwurf) anlegen |
| GET/PATCH | /admin/auctions/:id | ADMIN | Parameter (nur DRAFT/SCHEDULED; ACTIVE: nur ends_at mit Begründung) |
| POST | /admin/auctions/:id/schedule | ADMIN | DRAFT → SCHEDULED |
| POST | /admin/auctions/:id/start | ADMIN | sofort starten |
| POST | /admin/auctions/:id/cancel | ADMIN | |
| POST | /admin/auctions/:id/extend | ADMIN | Endzeit ändern |
| GET | /admin/auctions/:id/bids | ADMIN | alle Gebote mit Identität |
| POST | /admin/auctions/:id/relist | ADMIN | UNSOLD erneut einstellen (neue Auktion) |
| POST | /admin/auctions/:id/accept-highest | ADMIN | Reserve nicht erreicht → Zuschlag zum Höchstgebot (manuell, nach Rücksprache) |
| POST | /admin/auctions/:id/decline | ADMIN | Fahrzeug UNSOLD → COMPLETED (Rückgabe) |

## Auktionen (Händler / Autohaus)
| GET | /auctions?filter… | Händler (Gruppe) / Autohaus (eigene) | Liste mit §32-Filtern, `sort=ending|newest|price` |
| GET | /auctions/:id | wie oben | Detail inkl. Fahrzeugakte (gefiltert) |
| GET | /auctions/:id/state | wie oben | Snapshot für Reconnect `{currentBid,bidCount,endsAt,serverNow,myStatus,minNextBid}` |
| GET | /auctions/:id/bids | wie oben | anonymisierte Gebotshistorie |
| POST | /auctions/:id/bids | Händler CAN_BID | `{amount, clientRequestId}` |
| PUT | /auctions/:id/max-bid | Händler CAN_BID | Bietagent setzen/ändern |
| DELETE | /auctions/:id/max-bid | Händler | deaktivieren |
| POST | /auctions/:id/buy-now | Händler | Sofortkauf |
| GET | /me/bids | Händler | eigene Gebote je Auktion mit Status |
| GET | /me/auctions?state=won|lost|active | Händler | |
| GET/PUT/DELETE | /watchlist(/:vehicleId) | Händler | Favoriten |
| WS | /ws | auth | `subscribe {channel}`, Events `bid`, `extended`, `ended`, `started`, `cancelled`, `notification` |

## Deals, Dokumente, Abholung
| GET | /deals | Käufer/Verkäufer (eigene) / ADMIN | |
| GET | /deals/:id | berechtigt | inkl. Status-Historie, Dokumente, Abholung |
| POST | /admin/deals/:id/status | ADMIN | PAID / READY_FOR_PICKUP / COMPLETED / CANCELLED |
| PUT | /deals/:id/pickup | ADMIN/Verkäufer | Abholinfos |
| POST | /deals/:id/pickup/schedule | Käufer/ADMIN | Termin |
| POST | /deals/:id/pickup/handed-over | Verkäufer | mit Abholcode |
| POST | /deals/:id/pickup/taken-over | Käufer | |
| GET | /deals/:id/documents | berechtigt | Versionen (gefiltert nach Rolle) |
| GET | /documents/:id/url | berechtigt | Signed URL |
| POST | /admin/deals/:id/documents/regenerate | ADMIN | neue Version |
| POST | /deals/:id/complaints | Käufer/ADMIN | |
| GET | /admin/complaints | ADMIN | |
| POST | /admin/complaints/:id/resolve | ADMIN | |

## Benachrichtigungen, Statistik
| GET | /notifications?unread | auth | |
| POST | /notifications/read | auth | |
| POST | /notifications/push-subscribe | auth | |
| GET | /admin/stats/overview | ADMIN | heute/Monat (§39) |
| GET | /admin/stats/companies/:id | ADMIN | §40/§41 |
| GET | /admin/stats/inspectors | ADMIN | §42 |
| GET | /inspector/stats | INSPECTOR | eigene |
