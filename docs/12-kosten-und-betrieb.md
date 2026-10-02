# 12 – Kosten und Betrieb bei 20 Autohäusern, 80 Händlern und 30 Auktionen pro Tag

Stand 02.10.2026. Alle Preise netto, Stand der Anbieter-Preislisten im Oktober 2026 (Quellen am Ende); vor der Bestellung die aktuelle Preisliste prüfen. Die Mengen sind Annahmen und unten hergeleitet, damit sie sich bei anderen Zahlen leicht nachrechnen lassen.

## Annahmen

| Größe | Annahme | Herleitung |
|---|---|---|
| Auktionen | 30 je Tag, 7 Tage die Woche = 900 je Monat, 10.800 je Jahr | Vorgabe |
| Fotos je Fahrzeug | 36 (28 Pflichtfotos + im Schnitt 8 Schaden-/Zusatzfotos) | Aufnahmeprozess |
| Speicher je Foto | 4,5 MB (Original ca. 4 MB, Web-Version 0,4 MB, Vorschau 0,05 MB) | Smartphone-JPEG; Originale bleiben erhalten (§8) |
| Motorvideo je Fahrzeug | 50 MB (10 bis 30 s, 1080p, ohne Umkodierung) | Begrenzung 100 MB |
| Dokumente und PDFs je Fahrzeug | 5 MB | Fahrzeugpapiere, 3 Deal-PDFs je Version |
| **Speicher je Fahrzeug** | **ca. 215 MB** | 36 × 4,5 + 50 + 5 |
| Speicherzuwachs | ca. 195 GB je Monat, ca. 2,3 TB je Jahr | 900 × 215 MB |
| Datenbank | unter 10 GB nach einem Jahr | Gebote, Akten, Audit-Log sind klein; Dateien liegen im Objektspeicher |
| Händlerabrufe | 80 Händler × 20 Auktionsseiten je Tag × ca. 3 MB (Web-Fotos, Vorschauen), dazu ca. 200 Videoabrufe je Tag | führt zu ca. 0,5 TB Ausgangsverkehr je Monat |

Was die Plattform dabei leisten muss, liegt weit unter dem, was gemessen wurde: 100 gleichzeitige Gebote auf eine Auktion, 50 Dauerbieter auf 30 Auktionen, 30 gleichzeitige Auktionsenden (`10-abnahme.md`, `lasttest-ergebnis.md`). 30 Auktionen je Tag mit 80 Händlern erzeugen im Tagesverlauf höchstens einige Gebote je Minute.

## Laufende Kosten je Monat

| Posten | Empfehlung | Preis je Monat | Anmerkung |
|---|---|---|---|
| Produktionsserver | Hetzner Cloud CX43 (8 vCPU, 16 GB RAM, 160 GB SSD), Falkenstein oder Nürnberg | ca. 17 € | Alle Container (Caddy, API, Worker, Web, Postgres, ClamAV, Backup) auf einem Server; ClamAV braucht allein ca. 2 GB RAM. CX33 (8 GB, 8,49 €) reicht technisch, lässt aber wenig Luft. Dedizierte vCPU (CCX) ist nach den Preiserhöhungen 2026 deutlich teurer (ca. 30 bis 90 €) und bei dieser Last nicht nötig. |
| Staging-Server | Hetzner Cloud CX33 (4 vCPU, 8 GB) | ca. 8,50 € | Für den Staging-Durchlauf (DoD 22) und spätere Updates. Kann nach dem Livegang auf Monatsbasis abgeschaltet werden. |
| Objektspeicher (Fotos, Videos, PDFs) | Hetzner Object Storage (S3-kompatibel) | Jahr 1 ca. 6,50 bis 15 €, Jahr 2 ca. 25 €, Jahr 3 ca. 40 € | Grundpreis 6,49 € mit 1 TB Speicher und 1 TB Ausgangsverkehr, danach ca. 6,50 € je weiterem TB. Der Bestand wächst um ca. 2,3 TB je Jahr, weil Fahrzeugakten dauerhaft bleiben (§8). Ausgangsverkehr (ca. 0,5 TB) liegt im Inklusivvolumen. |
| Kopie außer Haus (Backups) | Hetzner Storage Box BX21 (5 TB) | 10,90 € | Datenbank-Dumps, WAL-Archiv und Basissicherungen per rclone (`scripts/backup.sh`); zusätzlich eine Zweitkopie des Objektspeichers (rclone sync). 5 TB reichen für gut zwei Jahre, danach BX31 (10 TB). Ein 1-TB-Bezug (3,20 €) genügt nur ohne Zweitkopie der Fotos. |
| Domain und TLS | eine Domain, Zertifikate über Caddy (Let's Encrypt) | ca. 1,50 € | Jahrespreis der Domain umgelegt; Zertifikate kostenlos. |
| E-Mail-Versand (SMTP) | Amazon SES, alternativ Brevo oder Postmark | ca. 2 bis 30 € | ca. 20.000 Mails je Monat (Überboten, Zuschlag, Zahlung, Abholung). SES ca. 0,10 € je 1.000 Mails; Postmark ab ca. 15 US-$ je 10.000. |
| KI-Bilderkennung (FIN vom Foto, Bildausschnitt) | Anthropic-API, Modell per `ANTHROPIC_MODEL` wählbar | Haiku 4.5 ca. 25 €, Sonnet 5 ca. 50 €, Fable 5.1 ca. 250 € | Je Fahrzeug 1 FIN-Erkennung und 12 Bildausschnitt-Prüfungen, zusammen ca. 21.000 Eingabe- und 1.500 Ausgabe-Token. Preise je Million Token: Haiku 4.5 1 $/5 $, Sonnet 5 2 $/10 $, Fable 5.1 10 $/50 $. Empfehlung: Sonnet 5 für die FIN, Haiku 4.5 für die Bildausschnitt-Prüfung (`ANTHROPIC_MODEL_PHOTO_CHECK`), zusammen ca. 25 €. |
| Überwachung | Uptime-Monitor auf `/api/v1/health` (z. B. UptimeRobot, Better Stack), Benachrichtigung per E-Mail/SMS | 0 bis 25 € | Kostenlose Stufen reichen für einen Endpunkt im Minutentakt. |
| **Summe** | | **ca. 70 bis 160 € je Monat im ersten Jahr** (ohne Fable 5.1), **ca. 95 bis 185 €** im dritten Jahr | Untergrenze: CX43, Staging, Objektspeicher Grundpreis, Storage Box, Domain, SES, Haiku, kostenloser Monitor. Obergrenze: Postmark, Sonnet 5, bezahlter Monitor. Mit Fable 5.1 für alle KI-Prüfungen kommen ca. 200 bis 230 € je Monat hinzu. |

Zum Vergleich: Die gleiche Umgebung bei einem großen Hyperscaler (verwaltete Datenbank, S3, Container) läge nach denselben Mengen bei grob 300 bis 600 € je Monat. Die Plattform ist bewusst so gebaut, dass sie auf einem einzelnen Server mit Docker läuft.

## Einmalige Kosten (außerhalb der Technik)

| Posten | Größenordnung | Anmerkung |
|---|---|---|
| Rechtstexte (AGB, Bieterbedingungen, Datenschutzerklärung, Impressum, Kaufvertragstexte) | 1.500 bis 5.000 € | Anwalt; die Plattform enthält nur gekennzeichnete Vorlagen (§61). |
| Auftragsverarbeitungsverträge | 0 € | Hetzner, E-Mail-Anbieter und Anthropic stellen Standardverträge; nur abschließen und ablegen. |
| Unabhängiger Sicherheitstest (Penetrationstest) | 3.000 bis 10.000 € | Vor dem Livegang üblich, weil Gebote verbindlich sind und Geld fließt (`09-security-review.md`). |
| Einrichtung des Zielsystems | 1 bis 2 Arbeitstage Technik | Server, DNS, Env-Dateien, Erstkonfiguration, Staging-Durchlauf nach `11-livegang-checkliste.md`. |

## Betrieb: Was 30 Aufnahmen je Tag organisatorisch bedeuten

Diese Zahlen sind keine Softwarekosten, bestimmen aber, ob 30 Auktionen je Tag erreichbar sind.

| Größe | Annahme | Ergebnis |
|---|---|---|
| Dauer einer Aufnahme vor Ort | 45 bis 60 min (28 Fotos, Schäden, Lack, Reifen, OBD, Funktionen, Motorvideo) | 30 Aufnahmen = 22 bis 30 Stunden je Tag |
| Anfahrten | 20 Autohäuser, im Schnitt 1,5 Fahrzeuge je Termin | ca. 20 Termine je Tag, 30 bis 45 min Fahrt je Termin |
| Außendienst | | **4 bis 5 Mitarbeiter** im Vollzeiteinsatz, dazu Vertretung |
| Admin-Prüfung | 10 bis 15 min je Akte (Prüfung, Korrekturen, Auktionsparameter) | 5 bis 7,5 Stunden je Tag, also eine Vollzeitstelle |
| Mobile Datenmengen | 215 MB je Fahrzeug | ca. 6,5 GB je Tag über alle Mitarbeiter; Mobilfunktarife ohne Volumenbegrenzung oder WLAN im Autohaus |

## Was die Technik bei diesen Mengen nicht braucht

- Keine zweite API-Instanz, kein Load Balancer, kein Redis: Der Lasttest lag um ein Vielfaches über der erwarteten Last. Die Architektur erlaubt die Erweiterung später (`01-architektur.md`, Abschnitt Skalierung).
- Keine Videotranskodierung: Smartphones liefern MP4/H.264 oder WebM, die Browser direkt abspielen. iPhone-Aufnahmen in HEVC (.mov) spielen in Safari und Edge, in Chrome unter Windows nur mit installierten HEVC-Erweiterungen; für den Fall ist in `11-livegang-checkliste.md` eine Prüfung mit echten Geräten vorgesehen.
- Keine Content-Delivery-Plattform: Fotos kommen über kurzlebige Signed URLs direkt aus dem Objektspeicher.

## Quellen (Preisstand Oktober 2026)

- Hetzner Cloud Serverpreise: [comparedge.com](https://comparedge.com/tools/hetzner/pricing), [costgoat.com](https://costgoat.com/pricing/hetzner), [northflank.com](https://northflank.com/blog/hetzner-cloud-server-price-increases)
- Hetzner Object Storage: [bex.co](https://bex.co/blog/2026/09/11/hetzner-object-storage-tenant-backup-backend), [harbingerexplorer.com](https://www.harbingerexplorer.com/aws/s3-vs-hetzner-object-storage)
- Hetzner Storage Box: [whtop.com BX11](https://www.whtop.com/plans/hetzner.com/128269), [whtop.com BX21](https://www.whtop.com/plans/hetzner.com/128270)
- Anthropic-API: [benchlm.ai](https://benchlm.ai/anthropic/api-pricing), [finout.io](https://www.finout.io/blog/anthropic-api-pricing)
