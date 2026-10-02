import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';
import { apiAs, L, login, PASSWORD, pdfFile, photo, uniq } from './support';

/**
 * Kompletter Geschäftsablauf (Spezifikation §52/§63) über die echte Oberfläche:
 * Autohaus registriert → Admin prüft und gibt frei → Autohaus meldet Fahrzeuge → Admin disponiert →
 * Außendienst nimmt Fahrzeug vollständig auf → Admin prüft → Auktion startet → zwei Händler bieten live →
 * Auktion endet serverseitig → genau ein Gewinner → Deal → PDFs → Abholung → Statistik → Audit-Log.
 */

const REQUIRED_SLOTS = [
  'Vorne links 45°', 'Frontal', 'Vorne rechts 45°', 'Rechte Seite', 'Hinten rechts 45°', 'Hinten', 'Hinten links 45°', 'Linke Seite',
  'Dach', 'Motorraum', 'Kofferraum offen', 'Fahrerplatz', 'Armaturenbrett', 'Infotainment', 'Vordersitze', 'Rückbank', 'Himmel', 'Schlüssel',
  'Felge vorne links', 'Felge vorne rechts', 'Felge hinten links', 'Felge hinten rechts', 'Reifen vorne links', 'Reifen vorne rechts', 'Reifen hinten links', 'Reifen hinten rechts',
];
const PAINT = ['Motorhaube', 'Kotflügel VL', 'Tür VL', 'Tür HL', 'Seitenteil HL', 'Kofferraumdeckel', 'Seitenteil HR', 'Tür HR', 'Tür VR', 'Kotflügel VR', 'Dach'];
/** 30 Ausstattungsmerkmale: 22 erscheinen im Auszug der Übersicht, 8 hinter „Vollständige Ausstattung anzeigen“. */
const EQUIPMENT = [
  'M-Sportpaket', 'LED-Scheinwerfer', 'Navigationssystem Professional', 'Head-Up Display', 'Sitzheizung vorne', 'Harman Kardon Soundsystem',
  'Rückfahrkamera', 'Parksensoren vorne & hinten', 'Spurhalteassistent', 'Keyless Go', 'Elektrische Heckklappe', 'Sportsitze', 'Panorama-Glasdach',
  'Adaptive Cruise Control', 'Live Cockpit Professional', 'M Lederlenkrad', 'Ambientebeleuchtung', '3-Zonen Klimaautomatik', '19" Leichtmetallfelgen',
  'Verkehrszeichenerkennung', 'Fernlichtassistent', 'Induktives Laden', 'Anhängerkupplung', 'Standheizung', 'Lenkradheizung', 'Komfortzugang',
  'Sonnenschutzrollos', 'DAB-Radio', 'Apple CarPlay', 'Notrufsystem',
];

/** Wert für ein datetime-local-Feld (Minutengenauigkeit) in der Zeitzone der Browser-Kontexte, unabhängig vom Testrechner. */
function localInput(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function registerDealer(browser: import('@playwright/test').Browser, admin: BrowserContext, n: number): Promise<{ context: BrowserContext; page: Page; email: string }> {
  const context = await browser.newContext();
  const email = `${uniq(`haendler${n}`)}@e2e.test`;
  const reg = await apiAs(context, 'POST', '/register/dealer', {
    name: `E2E Händler ${n}`, legalForm: 'GmbH', street: 'Handelsweg', houseNumber: String(n), zip: '30880', city: 'Laatzen', website: null, registerNumber: null,
    vatId: 'DE111111111', tradeType: 'Kfz-Handel', bankIban: null, firstName: 'Händler', lastName: `Nummer${n}`, phone: '+49 511 222222', email, password: PASSWORD,
    acceptTerms: true, acceptPrivacy: true, acceptBidderTerms: true,
  });
  expect(reg.status(), await reg.text()).toBe(201);
  const { companyId } = await reg.json();
  // Gewerbenachweis und Freigabe (Vorbedingung, die Registrierung über die Oberfläche testet der Autohaus-Teil).
  const fs = await import('node:fs');
  const up = await context.request.post(`${E2E.web}/api/v1/company/documents`, {
    headers: { origin: E2E.web },
    multipart: { kind: 'TRADE_LICENSE', file: { name: 'gewerbe.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(pdfFile()) } },
  });
  expect(up.status(), await up.text()).toBe(201);
  const ap = await apiAs(admin, 'POST', `/admin/companies/${companyId}/status`, { action: 'approve' });
  expect(ap.status(), await ap.text()).toBe(200);
  const page = await context.newPage();
  return { context, page, email };
}

test('Kompletter Ablauf von der Registrierung bis zur Abholung', async ({ browser }) => {
  const tag = uniq('e2e');
  const dealershipName = `Autohaus ${tag}`;
  const dealershipEmail = `${tag}@autohaus.test`;

  // ------------------------------------------------------------------ 1. Autohaus registriert sich
  const ahContext = await browser.newContext();
  const ah = await ahContext.newPage();
  await ah.goto('/registrieren/autohaus');
  await ah.getByLabel('Firmenname').fill(dealershipName);
  await ah.getByLabel(L('Straße')).fill('Hauptstraße');
  await ah.getByLabel('Hausnummer').fill('12');
  await ah.getByLabel('PLZ').fill('30159');
  await ah.getByLabel(L('Ort')).fill('Hannover');
  await ah.getByLabel('Marken / Vertragspartnerschaften').fill('Volkswagen, Audi');
  await ah.getByLabel('Vorname').fill('Anna');
  await ah.getByLabel('Nachname').fill('Ahrens');
  await ah.getByLabel('Telefonnummer').fill('+49 511 123456');
  await ah.getByLabel('E-Mail').fill(dealershipEmail);
  await ah.getByLabel(L('Passwort')).fill(PASSWORD);
  await ah.getByLabel('Passwort wiederholen').fill(PASSWORD);
  await ah.getByLabel('Gewerbenachweis').setInputFiles(pdfFile());
  await ah.getByLabel(/AGB/).check();
  await ah.getByLabel(/Datenschutzerklärung/).check();
  await ah.getByRole('button', { name: 'Registrierung absenden' }).click();
  await ah.waitForURL('**/registrierung/status');
  await expect(ah.getByText('Prüfung läuft').first()).toBeVisible();

  // ------------------------------------------------------------------ 2. Admin prüft und gibt frei
  const { context: adminContext, page: admin } = await login(browser, E2E.adminEmail, E2E.adminPassword);
  await admin.goto('/admin/autohaeuser');
  await admin.getByRole('link', { name: new RegExp(dealershipName) }).click();
  await expect(admin.getByText('gewerbe.pdf')).toBeVisible();
  await admin.getByRole('button', { name: 'Freigeben' }).click();
  await expect(admin.getByText('Freigegeben').first()).toBeVisible();

  // ------------------------------------------------------------------ 3. Autohaus meldet Inzahlungnahmen
  await ah.goto('/autohaus');
  await ah.getByRole('link', { name: /Inzahlungnahmen stehen bereit/ }).click();
  await expect(ah.getByLabel('Straße und Hausnummer')).toHaveValue('Hauptstraße 12');
  await ah.getByLabel('Anzahl Fahrzeuge').fill('1');
  await ah.getByRole('button', { name: 'Anfrage absenden' }).click();
  await expect(ah.getByText(/Anfrage AU-\d{4}-\d{5} eingegangen/)).toBeVisible();
  await expect(ah.getByText('Anfrage eingegangen – Termin wird geplant.')).toBeVisible();

  // ------------------------------------------------------------------ 4. Admin legt Außendienst an und disponiert
  const inspectorEmail = `${tag}@aussendienst.test`;
  await admin.goto('/admin/mitarbeiter');
  await admin.getByRole('button', { name: 'Mitarbeiter anlegen' }).click();
  const dlg = admin.getByRole('dialog');
  await dlg.getByLabel('Vorname').fill('Max');
  await dlg.getByLabel('Nachname').fill(`E2E${tag.slice(-4)}`);
  await dlg.getByLabel('E-Mail').fill(inspectorEmail);
  await dlg.getByLabel('Mobilnummer').fill('+49 170 1234567');
  await dlg.getByLabel('Startpasswort').fill(PASSWORD);
  await dlg.getByRole('button', { name: 'Anlegen' }).click();
  await expect(admin.getByText(inspectorEmail)).toBeVisible();

  await admin.goto('/admin/disposition');
  const card = admin.locator('article', { hasText: dealershipName });
  await card.getByRole('button', { name: 'Mitarbeiter zuweisen' }).click();
  const assign = admin.getByRole('dialog');
  await assign.getByLabel('Außendienstmitarbeiter').selectOption({ label: `Max E2E${tag.slice(-4)}` });
  await assign.getByRole('button', { name: 'Mitarbeiter zuweisen' }).click();
  await expect(assign).toBeHidden();

  await ah.goto('/autohaus/termine');
  await expect(ah.getByText(new RegExp(`Mitarbeiter Max E\\.`))).toBeVisible();

  // ------------------------------------------------------------------ 5. Außendienst nimmt das Fahrzeug auf (mobil)
  const { page: insp } = await login(browser, inspectorEmail, PASSWORD, { mobile: true });
  await insp.goto('/aussendienst/termine');
  const appt = insp.locator('article', { hasText: dealershipName });
  await appt.getByRole('button', { name: 'Angekommen' }).click();
  await appt.getByRole('button', { name: 'Aufnahme starten' }).click();
  await appt.getByRole('link', { name: 'Zur Fahrzeugaufnahme' }).click();
  await insp.getByRole('button', { name: 'Fahrzeug hinzufügen' }).click();
  await insp.waitForURL('**/aussendienst/fahrzeug/**');

  // Schritt 1: FIN + FIN-Foto
  const vin = `WVWZZZ1KZ${String(Date.now()).slice(-8)}`;
  await insp.getByLabel('FIN / VIN').fill(vin);
  await insp.getByLabel('Foto aufnehmen: FIN').setInputFiles(await photo(1));
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 2: Kilometer + Tachofoto
  await insp.getByLabel('Kilometerstand').fill('87300');
  await insp.getByLabel('Foto aufnehmen: Tacho').setInputFiles(await photo(2));
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 3: Dokumente
  await insp.getByLabel(L('Dokument fotografieren: Zulassungsbescheinigung Teil I')).setInputFiles(await photo(3));
  await insp.getByRole('button', { name: 'Weiter', exact: true }).click();
  // Schritt 4: Stammdaten
  await insp.getByLabel('Hersteller').fill('BMW');
  await insp.getByLabel(L('Modell')).fill('320d');
  await insp.getByLabel('Variante').fill('Touring');
  await insp.getByLabel('Erstzulassung').fill('2020-05-01');
  await insp.getByLabel('Kraftstoff').selectOption({ label: 'Diesel' });
  await insp.getByLabel('Leistung (kW)').fill('140');
  await insp.getByLabel('Getriebe').selectOption({ label: 'Automatik' });
  await insp.getByLabel('Farbe').fill('Schwarz');
  await insp.getByLabel('Schadstoffklasse').selectOption({ label: 'Euro 6d' });
  await insp.getByLabel('Fahrzeughalter').selectOption({ label: 'Gewerblich' });
  await insp.getByLabel(L('Ausstattung')).fill(EQUIPMENT.join('\n'));
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 5: Pflichtfotos
  let seed = 100;
  for (const slot of REQUIRED_SLOTS) {
    await insp.getByLabel(L(`Foto aufnehmen: ${slot}`)).setInputFiles(await photo(seed++));
  }
  await expect(insp.getByText('28/28')).toBeVisible({ timeout: 30_000 });
  await insp.getByRole('button', { name: 'Weiter', exact: true }).click();
  // Schritt 6: Schaden über die Skizze
  await insp.getByRole('button', { name: 'Kotflügel vorne rechts', exact: true }).click();
  const damage = insp.getByRole('dialog');
  await damage.getByRole('button', { name: 'Delle', exact: true }).click();
  await damage.getByLabel('Größe').fill('ca. 3 cm');
  await damage.getByLabel('Detailfoto aufnehmen').setInputFiles(await photo(500));
  await damage.getByRole('button', { name: 'Schaden speichern' }).click();
  await insp.getByRole('button', { name: 'Weiter', exact: true }).click();
  // Schritt 7: PDR
  await insp.getByRole('button', { name: 'Nein', exact: true }).click();
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 8: Lack
  for (const [i, p] of PAINT.entries()) await insp.getByLabel(p, { exact: true }).fill(String(i === 2 ? 320 : 110));
  await expect(insp.getByText('Auffälliger Wert').first()).toBeVisible();
  await insp.getByRole('button', { name: /Speichern und weiter \(11\/11\)/ }).click();
  // Schritt 9: Reifen
  await insp.getByLabel('Hersteller').first().fill('Michelin');
  await insp.getByRole('button', { name: /übernehmen/ }).click();
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 10: OBD (optional)
  await insp.getByRole('button', { name: 'Ohne OBD-Bericht weiter' }).click();
  // Schritt 11: Batterie
  await insp.getByLabel('Spannung 12 V-Batterie (V)').fill('12,6');
  await insp.getByRole('button', { name: 'Speichern und weiter' }).click();
  // Schritt 12: Funktionsprüfung
  await insp.getByRole('button', { name: /als „nicht geprüft“ markieren/ }).click();
  await insp.getByRole('button', { name: /Speichern und weiter \(15\/15\)/ }).click();
  // Schritt 13: Abschluss (wartet, bis alle Uploads übertragen sind)
  const finish = insp.getByRole('button', { name: 'Fahrzeugaufnahme abschließen' });
  await expect(finish).toBeEnabled({ timeout: 120_000 });
  await finish.click();
  await insp.waitForURL('**/aussendienst/auftrag/**');
  const completeOrder = insp.getByRole('button', { name: 'Auftrag abschließen' });
  await expect(completeOrder).toBeEnabled({ timeout: 60_000 });
  await completeOrder.click();
  await expect(insp.getByText('Auftrag abgeschlossen').first()).toBeVisible();

  // ------------------------------------------------------------------ 6. Admin prüft und gibt frei, Auktion wird angelegt
  await admin.goto('/admin/pruefung');
  await admin.getByRole('link', { name: 'BMW 320d' }).click();
  await expect(admin.getByText(/Vollständigkeit: 100 %/).first()).toBeVisible();
  await admin.getByRole('button', { name: 'Freigeben' }).click();
  await admin.waitForURL('**/admin/pruefung');
  // Katalog für die Brotkrumen der Auktionsseite („Hannover Auktion – Datum › Fahrzeug 1 von 1“).
  const catalogRes = await apiAs(adminContext, 'POST', '/admin/catalogs', { name: `Hannover Auktion ${tag.slice(-4)}`, startsAt: new Date(Date.now() + 86_400_000).toISOString() });
  expect(catalogRes.status(), await catalogRes.text()).toBe(201);
  await admin.goto('/admin/fahrzeuge');
  await admin.getByRole('link', { name: /BMW 320d/ }).click();
  await admin.getByRole('link', { name: 'Auktion anlegen' }).click();
  await admin.getByLabel('Katalog').selectOption({ label: `Hannover Auktion ${tag.slice(-4)}` });
  await admin.getByLabel('Startpreis (€)').fill('10000');
  await admin.getByLabel('Mindestpreis / Reserve (€)').fill('10000');
  await admin.getByLabel('Gebotsschritt (€)').fill('100');
  await admin.getByLabel(L('Start')).fill(localInput(new Date(Date.now() - 60_000)));
  await admin.getByRole('button', { name: 'Auktion anlegen und einplanen' }).click();
  await admin.waitForURL(/\/admin\/auktionen\/[0-9a-f-]{36}$/);
  const auctionId = admin.url().split('/').pop()!;
  await expect(admin.getByText('Läuft').first()).toBeVisible({ timeout: 30_000 });

  // ------------------------------------------------------------------ 7. Zwei Händler bieten live
  const A = await registerDealer(browser, adminContext, 1);
  const B = await registerDealer(browser, adminContext, 2);
  await A.page.goto(`/haendler/auktionen/${auctionId}`);
  await B.page.goto(`/haendler/auktionen/${auctionId}`);
  await expect(B.page.getByRole('button', { name: 'Jetzt 10.000 € bieten' })).toBeVisible();

  // Auktionsseite: Galerie, Eckdaten, Reiter, Standort, Favorit – alles bedienbar und mit echten Daten.
  await expect(B.page.getByText('LIVE', { exact: true })).toBeVisible();
  await expect(B.page.getByRole('heading', { level: 1, name: 'BMW 320d Touring' })).toBeVisible();
  await expect(B.page.getByRole('navigation', { name: 'Brotkrumen' })).toContainText(`Hannover Auktion ${tag.slice(-4)}`);
  await expect(B.page.getByRole('navigation', { name: 'Brotkrumen' })).toContainText('Fahrzeug 1 von 1');
  const facts = B.page.locator('dl').filter({ hasText: 'Schadstoffklasse' }).first();
  await expect(facts).toContainText('Euro 6d');
  await expect(facts).toContainText('Gewerblich');
  await expect(B.page.getByRole('tabpanel')).toContainText('Rückfahrkamera');
  await expect(B.page.getByRole('button', { name: 'Vollständige Ausstattung anzeigen (8 weitere)' })).toBeVisible();
  await B.page.getByRole('button', { name: 'Nächstes Bild' }).click();
  await expect(B.page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await B.page.getByRole('tab', { name: 'Schäden (1)' }).click();
  await expect(B.page.getByRole('tabpanel')).toContainText('Kotflügel vorne rechts');
  await B.page.getByRole('tab', { name: 'Reifen (4)' }).click();
  await expect(B.page.getByRole('tabpanel')).toContainText('Vorne links');
  await B.page.getByRole('button', { name: 'Auf Karte ansehen' }).click();
  await expect(B.page.getByRole('tab', { name: 'Standort' })).toHaveAttribute('aria-selected', 'true');
  const favorite = B.page.getByRole('button', { name: 'Favorit', exact: true });
  await favorite.click();
  await expect(favorite).toHaveAttribute('aria-pressed', 'true');
  // Verkäuferidentität bleibt vor dem Zuschlag verborgen (§3.3).
  await expect(B.page.getByText(dealershipName)).toHaveCount(0);
  // Bildschirmfotos zur Sichtprüfung in typischen Breiten (Artefakte, keine Prüfung).
  await B.page.getByRole('tab', { name: 'Übersicht' }).click();
  for (const [width, height] of [[1536, 1024], [1920, 1080], [1366, 768]] as const) {
    await B.page.setViewportSize({ width, height });
    await B.page.evaluate(() => window.scrollTo(0, 0));
    await B.page.screenshot({ path: `test-results/auktionsseite-${width}.png` });
  }
  await B.page.setViewportSize({ width: 1280, height: 720 });

  const placeBid = async (p: Page, amountLabel: string) => {
    await p.getByRole('button', { name: `Jetzt ${amountLabel} bieten` }).click();
    const confirm = p.getByRole('dialog');
    await expect(confirm.getByText('Mit Abgabe des Gebots geben Sie ein verbindliches Kaufangebot')).toBeVisible();
    await confirm.getByLabel('Ich bestätige, dass mein Gebot verbindlich ist.').check();
    await confirm.getByRole('button', { name: 'Verbindlich bieten' }).click();
    await expect(confirm).toBeHidden();
  };
  await placeBid(A.page, '10.000 €');
  await expect(A.page.getByText('Sie führen', { exact: true })).toBeVisible();
  // B sieht das neue Gebot und den nächsten Gebotsschritt ohne Neuladen (WebSocket).
  await expect(B.page.getByText('10.000 €').first()).toBeVisible({ timeout: 5_000 });
  await expect(B.page.getByRole('button', { name: 'Jetzt 10.100 € bieten' })).toBeVisible({ timeout: 5_000 });
  await placeBid(B.page, '10.100 €');
  await expect(B.page.getByText('Sie führen', { exact: true })).toBeVisible();
  await expect(A.page.getByText('Sie wurden überboten')).toBeVisible({ timeout: 5_000 });
  await expect(A.page.getByText('10.100 €').first()).toBeVisible();
  // Gebotsverlauf: andere Händler anonym, eigenes Gebot als „Sie“, Höchstgebot markiert.
  const historyA = A.page.locator('table').filter({ hasText: 'Händler' });
  await expect(historyA.getByRole('row').nth(1)).toContainText('Bieter');
  await expect(historyA.getByRole('row').nth(1)).toContainText('Höchstgebot');
  await expect(historyA).toContainText('Sie');
  await A.page.setViewportSize({ width: 1536, height: 1024 });
  await A.page.evaluate(() => window.scrollTo(0, 0));
  await A.page.screenshot({ path: 'test-results/auktionsseite-ueberboten-1536.png' });
  await A.page.setViewportSize({ width: 1280, height: 720 });

  // ------------------------------------------------------------------ 8. Admin verkürzt die Endzeit – Ende erfolgt serverseitig
  await admin.reload();
  // Das Feld kennt nur Minuten, der Server verlangt mindestens 60 s Vorlauf: nächste volle Minute mit mindestens 70 s Abstand.
  const newEnd = new Date(Math.ceil((Date.now() + 70_000) / 60_000) * 60_000);
  await admin.getByLabel('Endzeit ändern').fill(localInput(newEnd));
  await admin.getByLabel(L('Begründung')).first().fill('E2E-Test: kurzes Ende');
  await admin.getByRole('button', { name: /Endzeit übernehmen/ }).click();
  await expect(B.page.getByText(/Endzeit geändert/)).toBeVisible({ timeout: 10_000 });
  await expect(B.page.getByText('Zuschlag erhalten')).toBeVisible({ timeout: newEnd.getTime() - Date.now() + 60_000 });
  await expect(A.page.getByText('Nicht gewonnen')).toBeVisible({ timeout: 30_000 });
  // Nach Ende sind keine Gebote mehr möglich.
  const late = await apiAs(A.context, 'POST', `/auctions/${auctionId}/bids`, { amount: 2_000_000, clientRequestId: `late-${Date.now()}`, confirmBinding: true });
  expect(late.status()).toBe(409);

  // ------------------------------------------------------------------ 9. Deal und PDFs
  await B.page.goto('/haendler/kaeufe');
  await B.page.getByRole('link', { name: /^D-\d{4}-\d{6}$/ }).first().click();
  await expect(B.page.getByText('Kaufbestätigung (Käufer) (Version 1)')).toBeVisible({ timeout: 60_000 });
  await expect(B.page.getByText('Zahlung ausstehend').first()).toBeVisible();
  const dealUrl = B.page.url();
  const dealId = dealUrl.split('/').pop()!;
  const docHref = await B.page.getByRole('link', { name: 'Kaufbestätigung (Käufer) (Version 1)' }).getAttribute('href');
  const pdf = await B.context.request.get(`${E2E.web}${docHref}`);
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
  // Verlierer hat keinen Zugriff auf den Deal (IDOR-Schutz).
  expect((await apiAs(A.context, 'GET', `/deals/${dealId}`)).status()).toBe(404);

  // ------------------------------------------------------------------ 10. Zahlung, Abholung, Übergabe
  await admin.goto(`/admin/verkaeufe/${dealId}`);
  await admin.getByLabel('Status setzen').selectOption({ label: 'Zahlung eingegangen' });
  await admin.getByRole('button', { name: 'Status übernehmen' }).click();
  await expect(admin.getByText('Bezahlt').first()).toBeVisible();

  await ah.goto(`/autohaus/verkauft/${dealId}`);
  await ah.getByRole('button', { name: 'Abholinformationen bearbeiten' }).click();
  await ah.getByLabel('Öffnungszeiten').fill('Mo–Fr 8–18 Uhr');
  await ah.getByRole('button', { name: 'Speichern', exact: true }).click();
  await ah.getByRole('button', { name: 'Fahrzeug abholbereit melden' }).click();
  await expect(ah.getByText('Abholbereit').first()).toBeVisible();

  await B.page.reload();
  const code = (await B.page.locator('span.font-mono.text-2xl').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  await ah.getByLabel('Abholcode des Käufers').fill(code);
  await ah.getByRole('button', { name: 'Fahrzeug übergeben' }).click();
  await B.page.reload();
  await B.page.getByRole('button', { name: 'Fahrzeug übernommen' }).click();
  await expect(B.page.getByText('Abgeholt').first()).toBeVisible();

  // ------------------------------------------------------------------ 11. Statistik und Audit-Log
  await ah.goto('/autohaus');
  const soldKpi = ah.locator('div.rounded-lg', { has: ah.getByText('Verkauft', { exact: true }) }).first();
  await expect(soldKpi).toContainText('1');
  await admin.goto('/admin/audit');
  await admin.getByLabel('Ereignis').selectOption('DEAL_CREATED');
  await admin.getByRole('button', { name: 'Filtern' }).click();
  // Geprüft wird die Tabellenzeile (nicht die gleichnamige Option im Filter-Auswahlfeld) mit dem Deal dieses Laufs.
  const auditRow = admin.getByRole('table').getByRole('row').filter({ hasText: 'DEAL_CREATED' }).filter({ hasText: dealId.slice(0, 8) });
  await expect(auditRow).toBeVisible();
});
