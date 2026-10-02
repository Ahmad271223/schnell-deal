# 06 – Seitenstruktur (Next.js App Router)

Layout-Gruppen nach Rolle; Middleware leitet nach Login anhand `platform_role`/`company.type` auf den passenden Bereich. Jede Seite lädt Daten ausschließlich über die API (TanStack Query); keine Mock-Daten.

## Öffentlich
| Route | Inhalt |
|---|---|
| `/login` | Login |
| `/register` | Auswahl Autohaus / Händler |
| `/register/autohaus` | Registrierung Autohaus (mehrstufig, Upload Gewerbenachweis) |
| `/register/haendler` | Registrierung Händler |
| `/register/erfolg` | Hinweis „Prüfung läuft“ |
| `/legal/[kind]` | aktive Rechtstexte |

## Admin (`/admin`) – Desktop
| Route | Navigation | Inhalt |
|---|---|---|
| `/admin` | Dashboard | Heute/Monat-Kennzahlen (§39), Review-Queue-Zähler, laufende Auktionen |
| `/admin/anfragen` | Aufnahme-Anfragen | Liste, Filter, Detail-Drawer |
| `/admin/disposition` | Disposition | Tabs Heute/Morgen/Woche/Kalender/Karte/Ungeplant/Erledigt/Storniert; Karten per Drag & Drop auf Mitarbeiter-Spalten |
| `/admin/mitarbeiter` | Mitarbeiter | Inspektoren anlegen/bearbeiten, Statistik (§42) |
| `/admin/fahrzeuge` | Fahrzeuge | Bestand, Filter nach Status, Detail `/admin/fahrzeuge/[id]` (Akte, Revisionen, Kommentare, Dokumentfreigabe) |
| `/admin/pruefung` | Prüfung | Queue WAITING_REVIEW, Vollständigkeit %, Freigeben/Zurück |
| `/admin/kataloge` | Kataloge | Kataloge + Fahrzeuge + Sortierung |
| `/admin/auktionen` | Auktionen | Liste nach Status; `/admin/auktionen/neu`, `/admin/auktionen/[id]` (Parameter, Gebote mit Identität, Live-Status, Stop/Verlängern, Reserve-nicht-erreicht-Aktionen) |
| `/admin/verkaeufe` | Verkäufe | Deals, Statuskette, Dokumente, PDF neu erzeugen |
| `/admin/autohaeuser` | Autohäuser | Firmen DEALERSHIP, Prüfung, Freigabe, Nutzer |
| `/admin/haendler` | Händler | Firmen DEALER, Bieterstatus, Gruppen |
| `/admin/benutzer` | Benutzer | alle Benutzer |
| `/admin/dokumente` | Dokumente | alle erzeugten PDFs, Versionen |
| `/admin/reklamationen` | Reklamationen | Liste, bearbeiten |
| `/admin/statistiken` | Statistiken | Diagramme Plattform, Autohaus, Händler, Mitarbeiter |
| `/admin/audit` | Audit-Log | Filter, Detail (alt/neu) |
| `/admin/einstellungen` | Einstellungen | Gebühren, Anti-Sniping, Zahlungsfrist, Rechtstexte, Händlergruppen |

## Autohaus (`/autohaus`) – Desktop/Tablet
| Route | Navigation |
|---|---|
| `/autohaus` | Dashboard: KPIs (§5), Hauptbutton „Inzahlungnahmen stehen bereit“ |
| `/autohaus/melden` | Inzahlungnahmen melden (Formular §5) |
| `/autohaus/termine` | Termine: offene/vergangene Aufnahmeaufträge mit Status |
| `/autohaus/fahrzeuge` | Meine Fahrzeuge (+ `/[id]` Akte ohne interne Notizen) |
| `/autohaus/auktionen` | Aktive Auktionen (Live-Gebot, Restzeit) |
| `/autohaus/verkauft` | Verkauft (Deals, Übergabe bestätigen) |
| `/autohaus/nicht-verkauft` | Nicht verkauft |
| `/autohaus/dokumente` | Verkäufer-PDFs |
| `/autohaus/statistiken` | Firmenstatistik + Diagramme (§40) |
| `/autohaus/mitarbeiter` | Firmenbenutzer (OWNER/MANAGER) |
| `/autohaus/firma` | Firmendaten, Dokumente |

## Händler (`/haendler`) – Desktop

Einheitliches Layout für alle Rollen (Vorlage des Auftraggebers vom 02.10.2026): dunkle Seitenleiste mit rotem Logo und Navigation, helle Kopfzeile mit Fahrzeugsuche, Live-Anzeige, Benachrichtigungen, Favoriten, Sprachanzeige (Deutsch) und Benutzermenü. Bei Verbindungsstörungen erscheint ein schmaler Hinweis „Verbinde erneut …“.

| Route | Navigation |
|---|---|
| `/haendler` | Startseite: Kopfbereich mit Kennzahlen aus der Datenbank (aktive Auktionen, bald endende, neu in 24 h, „Sie führen“ über `GET /auctions/summary`), Kategorie-Chips, dann Reihen zum Wischen (Scroll-Snap, Finger/Maus/Pfeiltasten): Kataloge als Bildkarten (`GET /catalogs`, nur veröffentlichte Kataloge mit sichtbaren Auktionen), „Endet bald“, „Neu eingestellt“, „Ihre Favoriten“ (leere Reihen werden nicht angezeigt); darunter das Kartenraster aller Auktionen (§31) mit Filterleiste (§32) und Sortierung; übernimmt `?q=` (Suche aus der Kopfzeile) und `?katalog=` (Katalog-Link der Auktionsseite) |
| `/haendler/endet-bald` | Endet bald |
| `/haendler/neu` | Neu eingestellt |
| `/haendler/favoriten` | Favoriten |
| `/haendler/auktionen/[id]` | Detailseite nach Vorlage des Auftraggebers: Brotkrumen mit Katalog und „Fahrzeug n von m“ plus Vorheriges/Nächstes Fahrzeug (nur für den Händler sichtbare Auktionen); Galerie mit LIVE-Kennzeichnung, Pfeilen, Zähler, Vorschaubildern und Vollbild mit Zoom; Titel mit Auktionsnummer, Merkmal-Chips und „Geprüft“; Favorit und Teilen; Eckdatenleiste (Leistung, Kraftstoff, Getriebe, Karosserie, EZ, HU, Vorbesitzer, Fahrzeughalter, Schadstoffklasse); Medien-Umschalter (Alle Bilder · Zustandsbilder · Dokumente · Motorvideo) über der Galerie, Wischen auf dem Hauptbild. Darunter alle Daten als One-Pager in Karten (keine Reiter): Fahrzeugdaten in Gruppen (Allgemein, Herkunft & Besteuerung, Motor & Antrieb, Wartung & Historie, Hochvoltbatterie nur mit erfassten Werten) · Fahrzeugzustand als Kacheln mit Zählwerten (Schäden je Bereich, Lackmesspunkte, Funktionsprüfung, Fehlercodes; keine Aussage zur Unfallfreiheit, §14) · Fahrzeugschäden mit Skizze (Zahl je Bereich), Reiter je Schaden, Detailfotos mit Art/Schwere/Größe, Beschreibung, Vollbild · Lackschichtdicke als Raster · Technischer Zustand · Reifen · Diagnose · Fahrzeugdokumente (digital hinterlegt / nicht hinterlegt je Dokumentart) · Ausstattung (n) · Standort (Karte der PLZ-Region) · Hinweise des Betreibers (nur wenn in den Einstellungen gepflegt). Unterhalb der Desktop-Breite erscheint eine Milchglas-Leiste mit Preis, Restzeit und „Zum Gebot“, sobald das Bietpanel aus dem Bild gescrollt ist. Rechts das dunkle Live-Bietpanel: Countdown nach Serverzeit, aktuelles Gebot, eigenes Höchstgebot, nächstes Gebot, Zeitfortschritt, Mindestgebot, Sofortkauf, „Jetzt … € bieten“, „Maximalgebot setzen“, „Anderen Betrag bieten“, Verbindlichkeits-Dialog, Gebotsverlauf (anonym „Bieter N“, Filter „Meine Gebote“, „Alle n Gebote anzeigen“). Darunter Standort und Kontakt zum Plattformbetreiber; die Identität des Verkäufers bleibt bis zum Zuschlag verborgen (§3.3). |
| `/haendler/gebote` | Meine Gebote |
| `/haendler/gewonnen` | Gewonnen |
| `/haendler/kaeufe` | Käufe (Deals, Status, Zahlung) |
| `/haendler/abholung` | Abholung (Standort, Code, QR, „übernommen“) |
| `/haendler/dokumente` | Käufer-PDFs |
| `/haendler/firma` | Firmendaten, Mitarbeiter |

## Außendienst (`/aussendienst`) – Mobile-first, PWA
| Route | Navigation |
|---|---|
| `/aussendienst` | Heute: Terminliste (Uhrzeit, Autohaus, Fahrzeuge), Buttons Navigation / Anrufen / Angekommen / Aufnahme starten |
| `/aussendienst/termine` | Meine Termine (alle) |
| `/aussendienst/auftrag/[id]` | Auftrag: Fahrzeuge, „Fahrzeug hinzufügen“, Auftrag abschließen |
| `/aussendienst/fahrzeug/[id]` | Geführte Aufnahme (Stepper): 1 VIN (manuell, Barcode-Scan oder KI-Erkennung vom FIN-Foto als bestätigungspflichtiger Vorschlag) · 2 Kilometer+Tachofoto · 3 Dokumente · 4 Stammdaten · 5 Pflichtfotos (28 Slots, Qualitätsrückmeldung sofort lokal und nach Upload per KI „Fahrzeug vollständig im Bild“) · 6 Schäden (Skizze) · 7 PDR · 8 Lack · 9 Reifen · 10 OBD · 11 Batterie · 12 Funktionen · 13 Motorvideo (optional, 10 bis 30 s, bis 100 MB, über die Upload-Warteschlange) · 14 Zusammenfassung → Abschließen |
| `/aussendienst/uploads` | Offene Uploads: Queue-Status „18/52 hochgeladen“, Retry |
| `/aussendienst/abgeschlossen` | Abgeschlossene Aufnahmen |

Offline: Fotos landen in IndexedDB (Datei + Metadaten + `clientUploadId`), Upload-Worker im Client arbeitet die Queue ab (presign → PUT → complete), setzt bei Verbindungsabbruch automatisch fort. Formulardaten werden lokal zwischengespeichert und beim nächsten Online-Zustand synchronisiert.

## Gemeinsame Komponenten
`AppShell` (Navigation je Rolle), `StatusBadge` (Farbe + Text + Icon, nie nur Farbe), `Money`, `Countdown` (aus Server-Zeit), `DataTable`, `KpiCard`, `PhotoGrid`/`PhotoZoom`, `DamageSketch` (SVG-Zonen), `FileDropzone`, `ConfirmDialog`, `LiveBidPanel`, `NotificationBell`.
