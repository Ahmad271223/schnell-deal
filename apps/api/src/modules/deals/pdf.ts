import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  formatDateDe,
  formatDateTimeDe,
  formatEuro,
  formatIsoDateDe,
  formatKm,
  FUEL_LABELS,
  LEGAL_KIND_LABELS,
  TAX_TYPE_LABELS,
  TRANSMISSION_LABELS,
  kwToPs,
  type GeneratedDocumentKind,
} from '@sd/shared';
import { db, schema } from '../../core/db/client';
import { getSettings } from '../../core/settings';
import { newStorageKey, putObject, sha256 } from '../../core/storage';
import { audit, SYSTEM_ACTOR } from '../../core/audit';
import { markDocumentsReady } from './service';
import { notifyCompany } from '../notifications/service';

type Deal = typeof schema.deals.$inferSelect;
interface CompanySnap {
  id: string;
  name: string;
  legalForm: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  vatId: string | null;
  registerNumber: string | null;
  contact: string;
  phone: string;
  email: string;
}
interface VehicleSnap {
  internalNumber: string;
  vin: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  firstRegistration: string | null;
  mileageKm: number | null;
  fuel: keyof typeof FUEL_LABELS | null;
  powerKw: number | null;
  transmission: keyof typeof TRANSMISSION_LABELS | null;
  color: string | null;
  licensePlate: string | null;
}

interface PdfContext {
  deal: Deal;
  auction: typeof schema.auctions.$inferSelect;
  pickup: typeof schema.pickups.$inferSelect | undefined;
  invoices: (typeof schema.invoices.$inferSelect)[];
  winningBid: typeof schema.bids.$inferSelect;
  legalRefs: { kind: string; version: string; title: string; acceptedAt: Date }[];
  settings: Awaited<ReturnType<typeof getSettings>>;
  version: number;
  reason: string;
  generatedAt: Date;
}

const MARGIN = 50;

function render(kind: GeneratedDocumentKind, ctx: PdfContext, qr: Buffer | null): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, info: { Title: `${ctx.deal.dealNumber} – ${titleOf(kind)}`, Author: ctx.settings.platformName } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const d = ctx.deal;
    const seller = d.sellerSnapshot as CompanySnap;
    const buyer = d.buyerSnapshot as CompanySnap;
    const v = d.vehicleSnapshot as VehicleSnap;
    const width = doc.page.width - MARGIN * 2;

    // Kopf
    doc.font('Helvetica-Bold').fontSize(16).text(ctx.settings.platformName, { continued: false });
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(ctx.settings.platformAddress);
    doc.moveDown(0.8).fillColor('#000');
    doc.font('Helvetica-Bold').fontSize(14).text(titleOf(kind));
    doc.font('Helvetica').fontSize(10).text(`Deal-ID: ${d.dealNumber}    Dokumentversion: ${ctx.version}    Erstellt: ${formatDateTimeDe(ctx.generatedAt)}`);
    doc.text(`Anlass: ${ctx.reason}`);
    if (d.status === 'CANCELLED') {
      doc.moveDown(0.3).font('Helvetica-Bold').fillColor('#b00020').text(`STORNIERT${d.cancelledReason ? ` – ${d.cancelledReason}` : ''}`).fillColor('#000').font('Helvetica');
    }
    doc.moveDown(0.6);
    rule(doc, width);
    doc.x = MARGIN;

    const bottomLimit = () => doc.page.height - MARGIN - 25;
    const ensureSpace = (h: number) => {
      if (doc.y + h > bottomLimit()) {
        doc.addPage();
        doc.x = MARGIN;
        doc.y = MARGIN;
      }
    };
    const section = (t: string) => {
      ensureSpace(48);
      doc.y += 8;
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(t, MARGIN, doc.y, { width });
      doc.font('Helvetica').fontSize(10);
      doc.y += 3;
    };
    const row = (label: string, value: string) => {
      doc.font('Helvetica').fontSize(10);
      const h = Math.max(doc.heightOfString(label, { width: 190 }), doc.heightOfString(value || '–', { width: width - 195 }));
      ensureSpace(h + 4);
      const y = doc.y;
      doc.fillColor('#444').text(label, MARGIN, y, { width: 190 });
      doc.fillColor('#000').text(value || '–', MARGIN + 195, y, { width: width - 195 });
      doc.x = MARGIN;
      doc.y = y + h + 3;
    };
    const paragraph = (t: string) => {
      doc.font('Helvetica').fontSize(10).fillColor('#000');
      const h = doc.heightOfString(t, { width });
      ensureSpace(h + 4);
      doc.text(t, MARGIN, doc.y, { width });
      doc.x = MARGIN;
      doc.y += 4;
    };
    const companyBlock = (label: string, c: CompanySnap) => {
      row(label, `${c.name} ${c.legalForm}\n${c.street} ${c.houseNumber}, ${c.zip} ${c.city}\nAnsprechpartner: ${c.contact}, Tel. ${c.phone}${c.vatId ? `\nUSt-IdNr.: ${c.vatId}` : ''}`);
    };

    section('Vertragsparteien');
    if (kind === 'BUYER') {
      companyBlock('Käufer', buyer);
      companyBlock('Verkäufer', seller);
      row('Vermittlung', `${ctx.settings.platformName} (Plattformbetreiber)`);
    } else if (kind === 'SELLER') {
      companyBlock('Verkäufer (Einlieferer)', seller);
      companyBlock('Käufer', buyer);
      row('Vermittlung', `${ctx.settings.platformName} (Plattformbetreiber)`);
    } else {
      companyBlock(`Verkäufer (ID ${seller.id})`, seller);
      companyBlock(`Käufer (ID ${buyer.id})`, buyer);
    }

    section('Fahrzeug');
    row('Fahrzeug-ID', v.internalNumber);
    row('FIN', d.vinSnapshot ?? '–');
    row('Hersteller / Modell', `${v.make ?? ''} ${v.model ?? ''} ${v.variant ?? ''}`.trim());
    row('Erstzulassung', formatIsoDateDe(v.firstRegistration));
    row('Kilometerstand (bei Aufnahme)', formatKm(v.mileageKm));
    row('Kraftstoff / Getriebe', `${v.fuel ? FUEL_LABELS[v.fuel] : '–'} / ${v.transmission ? TRANSMISSION_LABELS[v.transmission] : '–'}`);
    if (v.powerKw) row('Leistung', `${v.powerKw} kW (${kwToPs(v.powerKw)} PS)`);
    if (kind !== 'BUYER' && v.licensePlate) row('Kennzeichen', v.licensePlate);

    section('Zuschlag und Beträge');
    row('Zuschlag am', formatDateTimeDe(d.soldAt));
    row('Auktionsende', formatDateTimeDe(d.auctionEndedAt));
    row('Steuerart', TAX_TYPE_LABELS[d.taxType]);
    row('Kaufpreis (Zuschlag)', `${formatEuro(d.salePrice)}${d.taxType === 'REGELBESTEUERT' ? ' netto' : ''}`);
    if (d.taxType === 'REGELBESTEUERT') row(`MwSt. ${d.vatRateBp / 100} % auf Kaufpreis`, formatEuro(d.vehicleVat));
    if (kind === 'BUYER' || kind === 'INTERNAL') {
      row('Käufergebühr netto', formatEuro(d.buyerFeeNet));
      row(`MwSt. ${d.vatRateBp / 100} % auf Käufergebühr`, formatEuro(d.buyerFeeVat));
      row('Gesamtbetrag Käufer', formatEuro(d.buyerTotal));
    }
    if (kind === 'SELLER' || kind === 'INTERNAL') {
      row('Plattformgebühr Verkäufer netto', formatEuro(d.sellerFeeNet));
      row(`MwSt. ${d.vatRateBp / 100} % auf Plattformgebühr`, formatEuro(d.sellerFeeVat));
      row('Auszahlungsbetrag an Verkäufer', formatEuro(d.sellerPayout));
    }
    if (kind === 'INTERNAL') {
      row('Provision Plattform (netto)', formatEuro(d.buyerFeeNet + d.sellerFeeNet));
      row('Gebührenkonfiguration', `Käufer ${ctx.auction.buyerFeePctBp / 100} % + ${formatEuro(ctx.auction.buyerFeeFixed)}; Verkäufer ${ctx.auction.sellerFeePctBp / 100} % + ${formatEuro(ctx.auction.sellerFeeFixed)}`);
    }
    for (const inv of ctx.invoices) {
      if ((kind === 'BUYER' && inv.kind !== 'BUYER_FEE') || (kind === 'SELLER' && inv.kind !== 'SELLER_FEE')) continue;
      row(inv.kind === 'BUYER_FEE' ? 'Rechnungsnr. Käufergebühr' : 'Rechnungsnr. Verkäufergebühr', `${inv.number} (${formatEuro(inv.gross)} brutto)`);
    }

    if (kind === 'BUYER') {
      section('Zahlungsinformationen');
      row('Zahlbar bis', formatDateDe(d.paymentDueAt));
      row('Verwendungszweck', d.dealNumber);
      paragraph(ctx.settings.paymentInstructions);
      section('Abholung');
      const p = ctx.pickup;
      row('Fahrzeug-ID', v.internalNumber);
      row('Standort', p ? `${p.locationStreet ?? ''}, ${p.locationZip ?? ''} ${p.locationCity ?? ''}` : '–');
      row('Ansprechpartner', p ? `${p.contactName ?? '–'}, Tel. ${p.contactPhone ?? '–'}` : '–');
      row('Öffnungszeiten', p?.openingHours ?? 'werden vom Verkäufer mitgeteilt');
      row('Früheste Abholung', formatIsoDateDe(ctx.auction.earliestPickup));
      row('Abholcode', p?.pickupCode ?? '–');
      if (qr) {
        ensureSpace(100);
        doc.image(qr, MARGIN + 195, doc.y + 2, { width: 90 });
        doc.y += 98;
      }
    }
    if (kind === 'SELLER') {
      section('Übergabe');
      row('Abholcode', 'Der Käufer weist sich bei Übergabe mit seinem Abholcode aus. Bitte bestätigen Sie die Übergabe in der Plattform.');
    }

    section('Auktionsreferenz');
    row('Auktion', `${ctx.auction.number}${kind === 'INTERNAL' ? ` (ID ${ctx.auction.id})` : ''}`);
    row('Start / Ende', `${formatDateTimeDe(ctx.auction.startedAt ?? ctx.auction.startsAt)} – ${formatDateTimeDe(ctx.auction.endedAt ?? ctx.auction.endsAt)}`);
    if (kind === 'INTERNAL') {
      row('Zustandekommen', d.origin);
      row('Gewinnergebot', `${formatEuro(ctx.winningBid.amount)} – Gebot #${ctx.winningBid.sequence} (${ctx.winningBid.kind})`);
      row('Transaktions-ID', ctx.winningBid.transactionId);
      row('Serverzeit Gebot', formatDateTimeDe(ctx.winningBid.serverTime));
      row('IP / Gerät', `${ctx.winningBid.ip ?? '–'} / ${(ctx.winningBid.userAgent ?? '–').slice(0, 80)}`);
      row('Gebote / Bieter / Verlängerungen', `${ctx.auction.bidCount} / ${ctx.auction.bidderCount} / ${ctx.auction.extensionCount}`);
      row('Mindestpreis', ctx.auction.reservePrice !== null ? formatEuro(ctx.auction.reservePrice) : 'keiner');
    }

    section('Geltende Bedingungen');
    if (ctx.legalRefs.length === 0) {
      paragraph('Es gelten die zum Zeitpunkt des Zuschlags gültigen Geschäfts- und Auktionsbedingungen der Plattform.');
    } else {
      for (const l of ctx.legalRefs) {
        row(LEGAL_KIND_LABELS[l.kind as keyof typeof LEGAL_KIND_LABELS] ?? l.kind, `${l.title}, Version ${l.version} (zugestimmt am ${formatDateTimeDe(l.acceptedAt)})`);
      }
    }

    // Fußzeile mit Seitenzahlen. Unterer Rand temporär 0, sonst fügt pdfkit leere Seiten ein.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.fontSize(8).fillColor('#777').text(
        `${d.dealNumber} · ${titleOf(kind)} · Version ${ctx.version} · Seite ${i + 1} von ${range.count}`,
        MARGIN,
        doc.page.height - 35,
        { width, align: 'center', lineBreak: false },
      );
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}

function rule(doc: PDFKit.PDFDocument, width: number) {
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + width, doc.y).strokeColor('#cccccc').stroke().strokeColor('#000');
}

function titleOf(kind: GeneratedDocumentKind): string {
  return kind === 'BUYER' ? 'Kaufbestätigung (Käufer)' : kind === 'SELLER' ? 'Verkaufsabrechnung (Verkäufer)' : 'Interner Vorgangsbeleg (Plattform)';
}

/**
 * Job `pdf.deal`: erzeugt Käufer-, Verkäufer- und internes PDF als neue Version.
 * Alle drei werden erst vollständig gerendert und gespeichert, dann in EINER Transaktion
 * registriert → keine halben Versionsstände. Alte Versionen bleiben unverändert erhalten.
 */
export async function generateDealDocumentsJob(payload: { dealId: string; reason: string; requestedBy?: string | null }): Promise<void> {
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, payload.dealId));
  if (!deal) throw new Error(`Deal ${payload.dealId} nicht gefunden`);
  const [auction] = await db.select().from(schema.auctions).where(eq(schema.auctions.id, deal.auctionId));
  const [pickup] = await db.select().from(schema.pickups).where(eq(schema.pickups.dealId, deal.id));
  const invoices = await db.select().from(schema.invoices).where(eq(schema.invoices.dealId, deal.id));
  const [winningBid] = await db.select().from(schema.bids).where(eq(schema.bids.id, deal.winningBidId));
  const settings = await getSettings();
  const legalRefs = await db
    .select({
      kind: schema.legalDocuments.kind,
      version: schema.legalDocuments.version,
      title: schema.legalDocuments.title,
      acceptedAt: schema.legalAcceptances.acceptedAt,
    })
    .from(schema.legalAcceptances)
    .innerJoin(schema.legalDocuments, eq(schema.legalDocuments.id, schema.legalAcceptances.legalDocumentId))
    .where(
      and(
        eq(schema.legalAcceptances.userId, winningBid!.userId),
        inArray(schema.legalDocuments.kind, ['TERMS', 'BIDDER_TERMS']),
        lte(schema.legalAcceptances.acceptedAt, winningBid!.serverTime),
      ),
    )
    .orderBy(desc(schema.legalAcceptances.acceptedAt));
  const latestPerKind = Object.values(
    legalRefs.reduce<Record<string, (typeof legalRefs)[number]>>((acc, r) => {
      if (!acc[r.kind]) acc[r.kind] = r;
      return acc;
    }, {}),
  );
  const [{ v }] = (
    await db.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from generated_documents where deal_id = ${deal.id}`)
  ).rows as [{ v: number }];
  const generatedAt = new Date();
  const qr = pickup ? await QRCode.toBuffer(`SD-PICKUP:${deal.dealNumber}:${pickup.pickupCode}`, { margin: 1, width: 240 }) : null;

  const kinds: GeneratedDocumentKind[] = ['BUYER', 'SELLER', 'INTERNAL'];
  const rendered: { kind: GeneratedDocumentKind; key: string; hash: string; size: number }[] = [];
  for (const kind of kinds) {
    const buf = await render(kind, { deal, auction: auction!, pickup, invoices, winningBid: winningBid!, legalRefs: latestPerKind, settings, version: v, reason: payload.reason, generatedAt }, qr);
    const key = newStorageKey(`deals/${deal.id}/${kind.toLowerCase()}`, 'pdf');
    await putObject(key, buf, 'application/pdf');
    rendered.push({ kind, key, hash: sha256(buf), size: buf.length });
  }

  await db.transaction(async (tx) => {
    // Version unter Lock erneut ermitteln (parallele Neuerzeugung).
    await tx.execute(sql`select id from deals where id = ${deal.id} for update`);
    const [{ v: version }] = (
      await tx.execute<{ v: number }>(sql`select coalesce(max(version), 0)::int + 1 as v from generated_documents where deal_id = ${deal.id}`)
    ).rows as [{ v: number }];
    if (version !== v) throw new Error('Versionskonflikt bei paralleler PDF-Erzeugung – wird wiederholt');
    for (const r of rendered) {
      await tx.insert(schema.generatedDocuments).values({
        dealId: deal.id,
        kind: r.kind,
        version,
        storageKey: r.key,
        sha256: r.hash,
        sizeBytes: r.size,
        reason: payload.reason,
        generatedBy: payload.requestedBy ?? null,
        generatedAt,
      });
    }
    await audit(tx, { ...SYSTEM_ACTOR, userId: payload.requestedBy ?? null }, {
      event: 'PDF_GENERATED',
      entityType: 'deal',
      entityId: deal.id,
      newValue: { version, reason: payload.reason, documents: rendered.map((r) => ({ kind: r.kind, sha256: r.hash })) },
    });
    if (deal.status === 'CREATED') {
      await markDocumentsReady(tx, SYSTEM_ACTOR, deal.id);
    } else {
      for (const c of [deal.buyerCompanyId, deal.sellerCompanyId]) {
        await notifyCompany(tx, c, {
          type: 'DOCUMENTS_READY',
          title: `Neue Dokumentversion: ${deal.dealNumber}`,
          body: `Version ${version} wurde erstellt (${payload.reason}).`,
          link: c === deal.buyerCompanyId ? `/haendler/kaeufe/${deal.id}` : `/autohaus/verkauft/${deal.id}`,
          email: false,
        });
      }
    }
  });
}
