'use client';

import Link from 'next/link';
import { Download, FileText, KeyRound, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import QR from 'qrcode';
import { useQuery } from '@tanstack/react-query';
import {
  COMPLAINT_STATUS_LABELS,
  DEAL_STATUS_LABELS,
  formatDateDe,
  formatDateTimeDe,
  formatIsoDateDe,
  formatKm,
  TAX_TYPE_LABELS,
  type ComplaintStatus,
  type DealStatus,
} from '@sd/shared';
import { api, generatedDocUrl } from '@/lib/api';
import { formatEuro, isoToLocalInput, localInputToIso } from '@/lib/format';
import type { DealView } from '@/lib/types';
import { Alert, Button, Card, DescriptionList, EmptyState, ErrorAlert, Field, Input, PageHeader, QueryState, Select, statusBadge, Table, Td, Textarea } from './ui';

type Role = 'admin' | 'buyer' | 'seller';

interface DealDetailData {
  deal: DealView;
  role: Role;
  history: { fromStatus: DealStatus | null; toStatus: DealStatus; note: string | null; createdAt: string }[];
  documents: { id: string; kind: 'BUYER' | 'SELLER' | 'INTERNAL'; version: number; reason: string; sha256: string; sizeBytes: number; generatedAt: string }[];
  invoices: { id: string; kind: string; number: string; net: number; vat: number; gross: number; issuedAt: string }[];
  pdfJob?: { status: string; attempts: number; last_error: string | null } | null;
  pickup: {
    locationStreet: string | null;
    locationZip: string | null;
    locationCity: string | null;
    contactName: string | null;
    contactPhone: string | null;
    openingHours: string | null;
    scheduledAt: string | null;
    handedOverAt: string | null;
    takenOverAt: string | null;
    pickupCode?: string;
    qrPayload?: string;
  } | null;
  complaints: { id: string; reason: string; description: string; status: ComplaintStatus; resolution: string | null; createdAt: string }[];
}

const DOC_LABEL = { BUYER: 'Kaufbestätigung (Käufer)', SELLER: 'Verkaufsabrechnung (Verkäufer)', INTERNAL: 'Interner Vorgangsbeleg' } as const;

export function DealsList({ basePath, title, filter }: { basePath: string; title: string; filter?: (d: DealView) => boolean }) {
  const q = useQuery({ queryKey: ['deals'], queryFn: () => api<DealView[]>('/deals') });
  const rows = (q.data ?? []).filter(filter ?? (() => true));
  return (
    <div>
      <PageHeader title={title} />
      <QueryState query={q}>
        {rows.length === 0 ? (
          <EmptyState title="Keine Vorgänge" />
        ) : (
          <Table head={['Deal-ID', 'Fahrzeug', 'FIN', 'Verkaufspreis', 'Status', 'Zuschlag', 'Zahlbar bis']}>
            {rows.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link href={`${basePath}/${d.id}`} className="font-medium text-brand-700 hover:underline">
                    {d.dealNumber}
                  </Link>
                </Td>
                <Td>
                  {d.vehicle.make} {d.vehicle.model} <span className="text-xs text-slate-500">({d.vehicle.internalNumber})</span>
                </Td>
                <Td className="font-mono text-xs">{d.vin}</Td>
                <Td className="tabular">{formatEuro(d.salePrice)}</Td>
                <Td>{statusBadge(DEAL_STATUS_LABELS, d.status)}</Td>
                <Td>{formatDateTimeDe(d.soldAt)}</Td>
                <Td>{formatDateDe(d.paymentDueAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryState>
    </div>
  );
}

export function DealDetail({ id, back }: { id: string; back: string }) {
  const q = useQuery({ queryKey: ['deal', id], queryFn: () => api<DealDetailData>(`/deals/${id}`), refetchInterval: 30_000 });
  return <QueryState query={q}>{q.data && <DealDetailView data={q.data} back={back} refetch={() => void q.refetch()} />}</QueryState>;
}

function DealDetailView({ data, back, refetch }: { data: DealDetailData; back: string; refetch: () => void }) {
  const { deal, role } = data;
  const latest = new Map<string, DealDetailData['documents'][number]>();
  for (const d of data.documents) if (!latest.has(d.kind) || latest.get(d.kind)!.version < d.version) latest.set(d.kind, d);

  return (
    <div>
      <PageHeader back={back} title={`Deal ${deal.dealNumber}`} subtitle={`${deal.vehicle.make ?? ''} ${deal.vehicle.model ?? ''} · ${deal.vehicle.internalNumber}`} actions={statusBadge(DEAL_STATUS_LABELS, deal.status)} />
      {deal.status === 'CANCELLED' && (
        <Alert tone="danger" title="Vorgang storniert" className="mb-4">
          {deal.cancelledReason}
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Fahrzeug und Zuschlag">
            <DescriptionList
              cols={3}
              items={[
                ['Fahrzeug-ID', deal.vehicle.internalNumber],
                ['FIN', <span key="vin" className="font-mono">{deal.vin}</span>],
                ['Erstzulassung', formatIsoDateDe(deal.vehicle.firstRegistration)],
                ['Kilometerstand', formatKm(deal.vehicle.mileageKm)],
                ['Zuschlag am', formatDateTimeDe(deal.soldAt)],
                ['Steuerart', TAX_TYPE_LABELS[deal.taxType]],
              ]}
            />
          </Card>
          <Card title="Beträge">
            <dl className="space-y-1 text-sm">
              <AmountRow label={`Kaufpreis${deal.taxType === 'REGELBESTEUERT' ? ' (netto)' : ''}`} value={deal.salePrice} />
              {deal.taxType === 'REGELBESTEUERT' && <AmountRow label={`MwSt. ${deal.vatRateBp / 100} %`} value={deal.vehicleVat} />}
              {deal.buyerFeeNet !== undefined && (
                <>
                  <AmountRow label="Käufergebühr netto" value={deal.buyerFeeNet} />
                  <AmountRow label="MwSt. auf Käufergebühr" value={deal.buyerFeeVat!} />
                  <AmountRow label="Gesamtbetrag Käufer" value={deal.buyerTotal!} strong />
                </>
              )}
              {deal.sellerFeeNet !== undefined && (
                <>
                  <AmountRow label="Plattformgebühr netto" value={deal.sellerFeeNet} />
                  <AmountRow label="MwSt. auf Plattformgebühr" value={deal.sellerFeeVat!} />
                  <AmountRow label="Auszahlung an Verkäufer" value={deal.sellerPayout!} strong />
                </>
              )}
            </dl>
            {role === 'buyer' && deal.status === 'PAYMENT_PENDING' && (
              <Alert tone="warning" className="mt-3" title="Zahlung ausstehend">
                Bitte überweisen Sie den Gesamtbetrag bis {formatDateDe(deal.paymentDueAt)} unter Angabe der Deal-ID {deal.dealNumber}. Die Zahlungsinformationen finden Sie in der Kaufbestätigung.
              </Alert>
            )}
          </Card>
          <PickupCard data={data} refetch={refetch} />
          {role !== 'seller' && <ComplaintsCard data={data} refetch={refetch} />}
        </div>
        <div className="space-y-4">
          <Card title="Vertragspartner">
            {deal.seller && (
              <PartyBlock title="Verkäufer" p={deal.seller} />
            )}
            {deal.buyer && <PartyBlock title="Käufer" p={deal.buyer} />}
            {role === 'admin' && <p className="mt-2 text-xs text-slate-500">Zustandekommen: {deal.origin}</p>}
          </Card>
          <Card title="Dokumente">
            {data.documents.length === 0 ? (
              <p className="text-sm text-slate-500">Dokumente werden erstellt …</p>
            ) : (
              <ul className="space-y-2">
                {[...latest.values()].map((d) => (
                  <li key={d.id}>
                    <a href={generatedDocUrl(d.id)} className="flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline">
                      <Download className="h-4 w-4" aria-hidden /> {DOC_LABEL[d.kind]} (Version {d.version})
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {data.documents.length > latest.size && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-slate-600">Frühere Versionen</summary>
                <ul className="mt-2 space-y-1">
                  {data.documents
                    .filter((d) => latest.get(d.kind)?.id !== d.id)
                    .map((d) => (
                      <li key={d.id}>
                        <a href={generatedDocUrl(d.id)} className="flex items-center gap-1 text-slate-700 hover:underline">
                          <FileText className="h-3.5 w-3.5" aria-hidden /> {DOC_LABEL[d.kind]} v{d.version} – {d.reason} ({formatDateTimeDe(d.generatedAt)})
                        </a>
                      </li>
                    ))}
                </ul>
              </details>
            )}
            {data.pdfJob && data.pdfJob.status === 'FAILED' && (
              <Alert tone="danger" className="mt-3" title="PDF-Erstellung fehlgeschlagen">
                {data.pdfJob.last_error ?? 'Unbekannter Fehler'} – über „Systemstatus“ erneut anstoßen.
              </Alert>
            )}
            {role === 'admin' && <AdminDealActions data={data} refetch={refetch} />}
          </Card>
          <Card title="Statusverlauf">
            <ol className="space-y-2">
              {data.history.map((h, i) => (
                <li key={i} className="text-sm">
                  {statusBadge(DEAL_STATUS_LABELS, h.toStatus)}
                  <span className="ml-2 text-xs text-slate-500">{formatDateTimeDe(h.createdAt)}</span>
                  {h.note && <p className="mt-0.5 text-xs text-slate-600">{h.note}</p>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </div>
  );
}

function AmountRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'border-t border-slate-200 pt-1 font-semibold' : ''}`}>
      <dt className="text-slate-600">{label}</dt>
      <dd className="tabular">{formatEuro(value)}</dd>
    </div>
  );
}

function PartyBlock({ title, p }: { title: string; p: NonNullable<DealView['seller']> }) {
  return (
    <div className="mb-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <p className="font-medium">
        {p.name} {p.legalForm}
      </p>
      <p className="text-slate-600">
        {p.street} {p.houseNumber}, {p.zip} {p.city}
      </p>
      <p className="text-slate-600">
        {p.contact} · <a href={`tel:${p.phone}`} className="text-brand-700">{p.phone}</a>
      </p>
    </div>
  );
}

function PickupQr({ payload }: { payload: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    void QR.toDataURL(payload, { margin: 1, width: 220 }).then(setSrc);
  }, [payload]);
  return src ? <img src={src} alt="QR-Code mit Abholcode" className="h-40 w-40 rounded border border-slate-200" /> : null;
}

function PickupCard({ data, refetch }: { data: DealDetailData; refetch: () => void }) {
  const { deal, role, pickup } = data;
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({
    locationStreet: pickup?.locationStreet ?? '',
    locationZip: pickup?.locationZip ?? '',
    locationCity: pickup?.locationCity ?? '',
    contactName: pickup?.contactName ?? '',
    contactPhone: pickup?.contactPhone ?? '',
    openingHours: pickup?.openingHours ?? '',
  });
  const [scheduledAt, setScheduledAt] = useState(isoToLocalInput(pickup?.scheduledAt));
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!pickup) return null;
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setEdit(false);
      refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const pickupPhase = ['READY_FOR_PICKUP', 'PICKUP_SCHEDULED', 'PICKED_UP'].includes(deal.status);
  return (
    <Card title="Abholung">
      {edit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ['locationStreet', 'Straße und Hausnummer'],
              ['locationZip', 'PLZ'],
              ['locationCity', 'Ort'],
              ['contactName', 'Ansprechpartner'],
              ['contactPhone', 'Telefon'],
            ] as const
          ).map(([k, label]) => (
            <Field key={k} label={label} required>
              <Input value={form[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))} />
            </Field>
          ))}
          <Field label="Öffnungszeiten" required className="sm:col-span-2">
            <Input value={form.openingHours} onChange={(e) => setForm((f) => ({ ...f, openingHours: e.target.value }))} placeholder="z. B. Mo–Fr 8–18 Uhr, Sa 9–13 Uhr" />
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={() => run('save', () => api(`/deals/${deal.id}/pickup`, { method: 'PUT', body: form }))} loading={busy === 'save'}>
              Speichern
            </Button>
            <Button variant="secondary" onClick={() => setEdit(false)}>
              Abbrechen
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <DescriptionList
            items={[
              ['Standort', [pickup.locationStreet, [pickup.locationZip, pickup.locationCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '–'],
              ['Ansprechpartner', pickup.contactName ? `${pickup.contactName}, ${pickup.contactPhone ?? ''}` : '–'],
              ['Öffnungszeiten', pickup.openingHours ?? 'noch nicht hinterlegt'],
              ['Abholtermin', pickup.scheduledAt ? formatDateTimeDe(pickup.scheduledAt) : 'noch nicht geplant'],
              ['Übergabe bestätigt (Verkäufer)', pickup.handedOverAt ? formatDateTimeDe(pickup.handedOverAt) : 'offen'],
              ['Übernahme bestätigt (Käufer)', pickup.takenOverAt ? formatDateTimeDe(pickup.takenOverAt) : 'offen'],
            ]}
          />
          {pickup.pickupCode && pickupPhase && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-slate-200 p-3">
              <span className="flex items-center gap-1 text-xs font-medium uppercase text-slate-500">
                <KeyRound className="h-3.5 w-3.5" aria-hidden /> Abholcode
              </span>
              <span className="font-mono text-2xl font-bold tracking-widest">{pickup.pickupCode}</span>
              {pickup.qrPayload && <PickupQr payload={pickup.qrPayload} />}
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <QrCode className="h-3 w-3" aria-hidden /> Bei Übergabe vorzeigen
              </span>
            </div>
          )}
        </div>
      )}

      {!edit && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4">
          {(role === 'seller' || role === 'admin') && !['PICKED_UP', 'COMPLETED', 'CANCELLED'].includes(deal.status) && (
            <Button variant="secondary" onClick={() => setEdit(true)}>
              Abholinformationen bearbeiten
            </Button>
          )}
          {(role === 'seller' || role === 'admin') && deal.status === 'PAID' && (
            <Button onClick={() => run('ready', () => api(`/deals/${deal.id}/ready-for-pickup`, { method: 'POST' }))} loading={busy === 'ready'}>
              Fahrzeug abholbereit melden
            </Button>
          )}
          {(role === 'buyer' || role === 'admin') && (deal.status === 'READY_FOR_PICKUP' || deal.status === 'PICKUP_SCHEDULED') && (
            <>
              <Field label="Abholtermin">
                <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
              </Field>
              <Button variant="secondary" disabled={!scheduledAt} onClick={() => run('schedule', () => api(`/deals/${deal.id}/pickup/schedule`, { method: 'POST', body: { scheduledAt: localInputToIso(scheduledAt) } }))} loading={busy === 'schedule'}>
                Termin speichern
              </Button>
            </>
          )}
          {(role === 'seller' || role === 'admin') && pickupPhase && !pickup.handedOverAt && (
            <>
              {role === 'seller' && (
                <Field label="Abholcode des Käufers">
                  <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="font-mono" />
                </Field>
              )}
              <Button variant="success" disabled={role === 'seller' && code.length < 4} onClick={() => run('handed', () => api(`/deals/${deal.id}/pickup/handed-over`, { method: 'POST', body: { pickupCode: code || undefined } }))} loading={busy === 'handed'}>
                Fahrzeug übergeben
              </Button>
            </>
          )}
          {(role === 'buyer' || role === 'admin') && pickupPhase && !pickup.takenOverAt && (
            <Button variant="success" onClick={() => run('taken', () => api(`/deals/${deal.id}/pickup/taken-over`, { method: 'POST', body: {} }))} loading={busy === 'taken'}>
              Fahrzeug übernommen
            </Button>
          )}
        </div>
      )}
      <ErrorAlert error={error} className="mt-3" />
    </Card>
  );
}

function ComplaintsCard({ data, refetch }: { data: DealDetailData; refetch: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const canOpen = !['CANCELLED', 'COMPLETED'].includes(data.deal.status);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/deals/${data.deal.id}/complaints`, { method: 'POST', body: { reason, description } });
      setOpen(false);
      setReason('');
      setDescription('');
      refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Reklamationen" actions={canOpen && !open ? <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Reklamation melden</Button> : undefined}>
      {open && (
        <div className="mb-4 space-y-3">
          <Field label="Grund" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Abweichender Kilometerstand" />
          </Field>
          <Field label="Beschreibung" required>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </Field>
          <div className="flex gap-2">
            <Button onClick={submit} loading={busy} disabled={!reason || !description}>
              Absenden
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
          </div>
          <ErrorAlert error={error} />
        </div>
      )}
      {data.complaints.length === 0 ? (
        <p className="text-sm text-slate-500">Keine Reklamationen.</p>
      ) : (
        <ul className="space-y-2">
          {data.complaints.map((c) => (
            <li key={c.id} className="rounded border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.reason}</span>
                {statusBadge(COMPLAINT_STATUS_LABELS, c.status)}
              </div>
              <p className="mt-1 text-slate-700">{c.description}</p>
              {c.resolution && <p className="mt-1 text-slate-600">Lösung: {c.resolution}</p>}
              <p className="mt-1 text-xs text-slate-500">{formatDateTimeDe(c.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AdminDealActions({ data, refetch }: { data: DealDetailData; refetch: () => void }) {
  const [status, setStatus] = useState<DealStatus | ''>('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setStatus('');
      setNote('');
      setReason('');
      refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const options: [DealStatus, string][] = [
    ['PAID', 'Zahlung eingegangen'],
    ['READY_FOR_PICKUP', 'Abholbereit'],
    ['PICKED_UP', 'Abgeholt'],
    ['COMPLETED', 'Abschließen'],
    ['CANCELLED', 'Stornieren'],
  ];
  return (
    <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Administration</p>
      <Field label="Status setzen">
        <Select value={status} onChange={(e) => setStatus(e.target.value as DealStatus)}>
          <option value="">Bitte wählen</option>
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={status === 'CANCELLED' ? 'Begründung (Pflicht)' : 'Notiz'}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button size="sm" disabled={!status} loading={busy === 'status'} variant={status === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => run('status', () => api(`/admin/deals/${data.deal.id}/status`, { method: 'POST', body: { status, note: note || null } }))}>
        Status übernehmen
      </Button>
      <Field label="PDFs neu erzeugen (Begründung)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Abholadresse korrigiert" />
      </Field>
      <Button size="sm" variant="secondary" disabled={!reason} loading={busy === 'regen'} onClick={() => run('regen', () => api(`/admin/deals/${data.deal.id}/documents/regenerate`, { method: 'POST', body: { reason } }))}>
        Neue Dokumentversion erzeugen
      </Button>
      <ErrorAlert error={error} />
    </div>
  );
}

export function DocumentsList({ title }: { title: string }) {
  const q = useQuery({
    queryKey: ['documents'],
    queryFn: () => api<{ id: string; kind: 'BUYER' | 'SELLER' | 'INTERNAL'; version: number; reason: string; generatedAt: string; dealId: string; dealNumber: string; vehicle: { make: string | null; model: string | null; internalNumber: string } }[]>('/documents'),
  });
  return (
    <div>
      <PageHeader title={title} subtitle="Alle Versionen bleiben dauerhaft erhalten." />
      <QueryState query={q} empty={<EmptyState title="Noch keine Dokumente" />}>
        <Table head={['Dokument', 'Deal', 'Fahrzeug', 'Version', 'Anlass', 'Erstellt']}>
          {q.data?.map((d) => (
            <tr key={d.id}>
              <Td>
                <a href={generatedDocUrl(d.id)} className="flex items-center gap-1 text-brand-700 hover:underline">
                  <Download className="h-4 w-4" aria-hidden /> {DOC_LABEL[d.kind]}
                </a>
              </Td>
              <Td>{d.dealNumber}</Td>
              <Td>
                {d.vehicle.make} {d.vehicle.model} ({d.vehicle.internalNumber})
              </Td>
              <Td>v{d.version}</Td>
              <Td className="whitespace-normal">{d.reason}</Td>
              <Td>{formatDateTimeDe(d.generatedAt)}</Td>
            </tr>
          ))}
        </Table>
      </QueryState>
    </div>
  );
}
