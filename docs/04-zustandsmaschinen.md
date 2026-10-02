# 04 – Zustandsmaschinen

Alle Übergänge sind in `packages/shared/src/state-machines.ts` als Tabellen definiert und werden serverseitig mit `assertTransition(machine, from, to)` erzwungen. Ungültige Übergänge → `409 INVALID_TRANSITION`. Jeder Übergang schreibt einen Audit-Eintrag.

## Company (Registrierung)

```
REGISTRATION_STARTED ──▶ DOCUMENTS_MISSING ──▶ IN_REVIEW ──▶ APPROVED ──▶ BLOCKED
         │                      ▲                 │   │           ▲           │
         └──────────────────────┘                 │   └─▶ REJECTED│           └──▶ APPROVED (entsperren)
                                                  └─▶ DOCUMENTS_MISSING (Nachforderung)
```

| von | nach | Auslöser |
|---|---|---|
| REGISTRATION_STARTED | IN_REVIEW | alle Pflichtfelder + Gewerbenachweis hochgeladen |
| REGISTRATION_STARTED | DOCUMENTS_MISSING | Registrierung ohne Upload abgeschlossen |
| DOCUMENTS_MISSING | IN_REVIEW | Upload nachgereicht |
| IN_REVIEW | APPROVED / REJECTED / DOCUMENTS_MISSING | Admin |
| APPROVED | BLOCKED | Admin |
| BLOCKED | APPROVED | Admin |
| REJECTED | IN_REVIEW | Admin (erneute Prüfung) |

## Dealer Bidding Status

`VIEW_ONLY ⇄ CAN_BID`, `CAN_BID → TEMP_BLOCKED (blocked_until) → CAN_BID`, `* → BLOCKED`, `BLOCKED → VIEW_ONLY`. Nur Admin.

## InspectionRequest

```
NEW ─▶ PLANNED ─▶ ASSIGNED ─▶ EN_ROUTE ─▶ ON_SITE ─▶ IN_PROGRESS ─▶ COMPLETED
 │        │          │           │          │            │
 └────────┴──────────┴───────────┴──────────┴────────────┴──▶ CANCELLED
```

| von | nach | Akteur |
|---|---|---|
| NEW | PLANNED | Admin setzt Termin ohne Mitarbeiter |
| NEW / PLANNED | ASSIGNED | Admin weist Mitarbeiter zu (Drag & Drop) |
| ASSIGNED | PLANNED | Admin entzieht Zuweisung |
| ASSIGNED | EN_ROUTE | Mitarbeiter „Navigation starten“/„unterwegs“ |
| EN_ROUTE | ON_SITE | Mitarbeiter „angekommen“ |
| ON_SITE | IN_PROGRESS | Mitarbeiter „Aufnahme starten“ |
| IN_PROGRESS | COMPLETED | Mitarbeiter schließt Auftrag ab (alle Fahrzeuge WAITING_REVIEW oder Begründung) |
| alle außer COMPLETED | CANCELLED | Admin / Autohaus (nur NEW/PLANNED) |

Die Spec-Status „neu“, „ungeplant“ werden beide auf `NEW` abgebildet (Ansicht „Ungeplant“ = `NEW` ohne `scheduled_at`); „Fahrzeuge warten auf Prüfung“ ist eine abgeleitete Ansicht (`COMPLETED` + Fahrzeuge in `WAITING_REVIEW`).

## Vehicle

```
DRAFT ─▶ INSPECTION_IN_PROGRESS ─▶ WAITING_REVIEW ─▶ APPROVED ─▶ SCHEDULED ─▶ IN_AUCTION ─▶ SOLD ─▶ COMPLETED
                                        │   ▲                         ▲             │
                                        ▼   │                         │             └─▶ UNSOLD ─▶ (erneut) SCHEDULED
                                 REQUIRES_CORRECTION                   │                    └─▶ COMPLETED (Rückgabe)
                                        └──────────────────────────────┘
```

| von | nach | Auslöser |
|---|---|---|
| DRAFT | INSPECTION_IN_PROGRESS | erster Schritt der geführten Aufnahme gespeichert |
| INSPECTION_IN_PROGRESS | WAITING_REVIEW | Mitarbeiter „Fahrzeugaufnahme abschließen“ – nur wenn Pflichtbilder vollständig & VIN valide & Tachofoto vorhanden; Akte wird gesperrt (`locked_at`) |
| WAITING_REVIEW | APPROVED | Admin freigeben |
| WAITING_REVIEW | REQUIRES_CORRECTION | Admin „zurück an Mitarbeiter“ / „Zusatzfotos verlangen“ (entsperrt für Mitarbeiter, Original bleibt via Revisions) |
| REQUIRES_CORRECTION | WAITING_REVIEW | Mitarbeiter schließt erneut ab |
| APPROVED | SCHEDULED | Auktion mit `starts_at` angelegt |
| SCHEDULED | APPROVED | Auktion gelöscht/storniert vor Start |
| SCHEDULED | IN_AUCTION | Auktion ACTIVE (Server-Job) |
| IN_AUCTION | SOLD | Auktion ENDED mit Zuschlag |
| IN_AUCTION | UNSOLD | Auktion ENDED ohne Zuschlag (Reserve nicht erreicht / keine Gebote) oder CANCELLED |
| UNSOLD | SCHEDULED | Admin stellt erneut ein |
| UNSOLD | COMPLETED | Admin: Rückgabe an Autohaus |
| SOLD | COMPLETED | Deal COMPLETED |

## Auction

```
DRAFT ─▶ SCHEDULED ─▶ ACTIVE ─▶ ENDED
  │          │          │
  └──────────┴──────────┴──▶ CANCELLED (nur ohne Zuschlag)
```

| von | nach | Auslöser |
|---|---|---|
| DRAFT | SCHEDULED | Admin „planen“ (Startzeit, Dauer, Parameter vollständig, Fahrzeug APPROVED) |
| SCHEDULED | ACTIVE | Scheduler-Job bei `starts_at <= now()` (atomar: `UPDATE … WHERE status='SCHEDULED' AND starts_at <= now()`) oder Admin „sofort starten“ |
| ACTIVE | ENDED | Scheduler-Job bei `ends_at <= now()` (atomar: `UPDATE … WHERE status='ACTIVE' AND ends_at <= now()`); Sofortkauf |
| DRAFT/SCHEDULED/ACTIVE | CANCELLED | Admin; bei ACTIVE nur solange kein Zuschlag; alle Bieter werden benachrichtigt |

**Ende/Outcome (im selben Commit wie `ENDED`):**
* `bid_count = 0` → `NO_BIDS`, Vehicle → UNSOLD
* `current_bid >= reserve_price` (oder keine Reserve) → `SOLD`, Deal wird angelegt, Vehicle → SOLD
* sonst → `RESERVE_NOT_MET`, Vehicle → UNSOLD; Admin-Optionen: ablehnen / Verkäufer kontaktieren / Höchstgebot nachverhandeln (manueller Deal zum Höchstgebot) / erneut einstellen

## Gebotsalgorithmus (Transaktion)

```
BEGIN;
  a := SELECT * FROM auctions WHERE id=$1 FOR UPDATE;          -- serialisiert alle Gebote je Auktion
  now := SELECT now();
  prüfe: a.status='ACTIVE' AND a.starts_at <= now AND now < a.ends_at    sonst 409 AUCTION_NOT_ACTIVE
  prüfe: Händler CAN_BID, Gruppe passt, Bieterbedingungen akzeptiert       sonst 403
  prüfe: amount >= max(a.start_price, a.current_bid + a.bid_increment)     sonst 409 BID_TOO_LOW (mit minNextBid)
  prüfe: amount % bid_increment == 0 relativ zu start_price (optional)     sonst 409
  Idempotenz: existiert bids(company_id, client_request_id) → gib dieses Gebot zurück
  -- Bietagent-Auflösung:
  m := aktives maximum_bid des aktuellen Höchstbieters (≠ Bieter)
  wenn m.max_amount >= amount:  neues Gebot wird mit status OUTBID gespeichert,
                                 Proxy-Gegengebot = min(m.max_amount, amount + increment) als PROXY-Bid des Führenden
  sonst:                         neues Gebot WINNING, alter Führender OUTBID
  wenn eigenes maximum_bid gesetzt/mitgegeben: speichern/aktualisieren (nie nach außen)
  Anti-Sniping: wenn a.anti_snipe_minutes > 0 und a.ends_at - now < anti_snipe_minutes → ends_at += anti_snipe_minutes, extension_count++
  UPDATE auctions SET current_bid, current_bidder_company_id, bid_count, ends_at, version+1;
  INSERT audit_logs; pg_notify('realtime', {auction_id, current_bid, bid_count, ends_at, serverNow, anonymisierter Bieter});
COMMIT;
```

Gebote exakt zum Endzeitpunkt: `now < ends_at` wird **innerhalb** des Locks geprüft; der End-Job nutzt denselben Lock (`FOR UPDATE`), daher gewinnt entweder das Gebot (dann ggf. Verlängerung) oder das Ende, nie beides.

Beim Setzen eines Maximalgebots ohne aktuelles Führen bietet der Server sofort den Mindestschritt (oder übertrumpft den aktuellen Führenden gemäß dessen Max) – in derselben Transaktion.

## Deal

```
CREATED ─▶ PAYMENT_PENDING ─▶ PAID ─▶ READY_FOR_PICKUP ─▶ PICKUP_SCHEDULED ─▶ PICKED_UP ─▶ COMPLETED
   │              │            │            │                   │               │
   └──────────────┴────────────┴────────────┴───────────────────┴───────────────┴─▶ DISPUTED ─▶ (COMPLETED | CANCELLED)
   └──────────────┴────────────┴─▶ CANCELLED
```

| von | nach | Akteur |
|---|---|---|
| CREATED | PAYMENT_PENDING | automatisch nach PDF-Erzeugung |
| PAYMENT_PENDING | PAID | Admin (Zahlungseingang bestätigt) |
| PAID | READY_FOR_PICKUP | Admin/Autohaus (Abholinfos + Abholcode erzeugt) |
| READY_FOR_PICKUP | PICKUP_SCHEDULED | Käufer/Admin setzt Termin |
| READY_FOR_PICKUP / PICKUP_SCHEDULED | PICKED_UP | Autohaus „übergeben“ + Käufer „übernommen“ (oder Admin) |
| PICKED_UP | COMPLETED | automatisch/Admin |
| jeder außer COMPLETED/CANCELLED | DISPUTED | Reklamation eröffnet |
| DISPUTED | vorheriger Status / CANCELLED | Admin löst Reklamation |
| CREATED / PAYMENT_PENDING / PAID | CANCELLED | Admin mit Begründung |
