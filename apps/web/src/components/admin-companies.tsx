'use client';

import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BIDDING_STATUS_LABELS,
  BIDDING_STATUSES,
  COMPANY_DOCUMENT_KIND_LABELS,
  COMPANY_ROLE_LABELS,
  COMPANY_STATUS_LABELS,
  COMPANY_STATUSES,
  formatDateTimeDe,
  type BiddingStatus,
  type CompanyDocumentKind,
  type CompanyRole,
  type CompanyStatus,
  type CompanyType,
} from '@sd/shared';
import { api, fieldErrors } from '@/lib/api';
import { formatEuro, isoToLocalInput, localInputToIso } from '@/lib/format';
import { fmtNum, fmtPct } from '@/lib/stats';
import { Alert, Button, Card, Checkbox, DescriptionList, EmptyState, ErrorAlert, Field, Input, KpiCard, Modal, PageHeader, QueryState, Select, StatusBadge, statusBadge, Table, Td } from './ui';

interface CompanyRow {
  id: string;
  type: CompanyType;
  name: string;
  legalForm: string;
  zip: string;
  city: string;
  status: CompanyStatus;
  contactEmail: string;
  contactPhone: string;
  createdAt: string;
  biddingStatus: BiddingStatus | null;
  userCount: number;
  documentCount: number;
}

export function CompanyAdminList({ type, title }: { type: CompanyType; title: string }) {
  const [status, setStatus] = useState<CompanyStatus | ''>('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const params = new URLSearchParams({ type });
  if (status) params.set('status', status);
  if (search) params.set('q', search);
  const q = useQuery({ queryKey: ['admin-companies', type, status, search], queryFn: () => api<CompanyRow[]>(`/admin/companies?${params.toString()}`) });
  return (
    <div>
      <PageHeader title={title} actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Manuell anlegen</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Suche Name, Ort, E-Mail" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={status} onChange={(e) => setStatus(e.target.value as CompanyStatus)} className="w-56">
          <option value="">Alle Status</option>
          {COMPANY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {COMPANY_STATUS_LABELS[s][0]}
            </option>
          ))}
        </Select>
      </div>
      <QueryState query={q} empty={<EmptyState title="Keine Unternehmen" />}>
        <Table head={['Unternehmen', 'Ort', 'Kontakt', 'Status', ...(type === 'DEALER' ? ['Bieterstatus'] : []), 'Benutzer', 'Nachweise', 'Registriert']}>
          {q.data?.map((c) => (
            <tr key={c.id}>
              <Td>
                <Link href={`/admin/unternehmen/${c.id}`} className="font-medium text-brand-700 hover:underline">
                  {c.name} {c.legalForm}
                </Link>
              </Td>
              <Td>
                {c.zip} {c.city}
              </Td>
              <Td className="text-xs">
                {c.contactEmail}
                <br />
                {c.contactPhone}
              </Td>
              <Td>{statusBadge(COMPANY_STATUS_LABELS, c.status)}</Td>
              {type === 'DEALER' && <Td>{statusBadge(BIDDING_STATUS_LABELS, c.biddingStatus)}</Td>}
              <Td>{c.userCount}</Td>
              <Td>{c.documentCount}</Td>
              <Td>{formatDateTimeDe(c.createdAt)}</Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <CreateCompanyDialog type={type} open={open} onClose={() => setOpen(false)} onCreated={() => void q.refetch()} />
    </div>
  );
}

function CreateCompanyDialog({ type, open, onClose, onCreated }: { type: CompanyType; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ name: '', legalForm: 'GmbH', street: '', houseNumber: '', zip: '', city: '', vatId: '', registerNumber: '', brands: '', tradeType: '', contactFirstName: '', contactLastName: '', contactPhone: '', contactEmail: '' });
  const [approve, setApprove] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ id: string }>('/admin/companies', {
        method: 'POST',
        body: { type, ...f, website: null, vatId: f.vatId || null, registerNumber: f.registerNumber || null, brands: f.brands.split(',').map((b) => b.trim()).filter(Boolean), tradeType: f.tradeType || null, approve },
      });
      onCreated();
      onClose();
      window.location.href = `/admin/unternehmen/${created.id}`;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, req = false) => (
    <Field label={label} required={req} error={fe[k]}>
      <Input value={f[k]} onChange={(e) => setF((o) => ({ ...o, [k]: e.target.value }))} />
    </Field>
  );
  return (
    <Modal open={open} onClose={onClose} title={type === 'DEALER' ? 'Händler manuell anlegen' : 'Autohaus manuell anlegen'} size="lg" footer={<Button onClick={submit} loading={busy}>Anlegen</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field('name', 'Firmenname', true)}
        {field('legalForm', 'Rechtsform', true)}
        {field('street', 'Straße', true)}
        {field('houseNumber', 'Hausnummer', true)}
        {field('zip', 'PLZ', true)}
        {field('city', 'Ort', true)}
        {field('vatId', 'USt-ID')}
        {field('registerNumber', 'Handelsregister')}
        {type === 'DEALERSHIP' ? field('brands', 'Marken (kommagetrennt)') : field('tradeType', 'Gewerbeart')}
        <div />
        {field('contactFirstName', 'Ansprechpartner Vorname', true)}
        {field('contactLastName', 'Ansprechpartner Nachname', true)}
        {field('contactPhone', 'Telefon', true)}
        {field('contactEmail', 'E-Mail', true)}
      </div>
      <div className="mt-3">
        <Checkbox checked={approve} onChange={setApprove} label="Sofort freigeben (Nachweise wurden außerhalb der Plattform geprüft)" />
      </div>
      <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
    </Modal>
  );
}

interface CompanyDetailData {
  id: string;
  type: CompanyType;
  name: string;
  legalForm: string;
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  website: string | null;
  registerNumber: string | null;
  vatId: string | null;
  brands: string[];
  tradeType: string | null;
  bankIban: string | null;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
  contactEmail: string;
  status: CompanyStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  documents: { id: string; kind: CompanyDocumentKind; fileName: string; mime: string; sizeBytes: number; sha256: string; createdAt: string }[];
  users: { id: string; email: string; firstName: string; lastName: string; phone: string | null; isActive: boolean; lastLoginAt: string | null; companyRole: CompanyRole; jobTitle: string | null }[];
  verification: { biddingStatus: BiddingStatus; blockedUntil: string | null; note: string | null } | null;
  groups: { id: string; name: string }[];
}

const ACTIONS: Record<CompanyStatus, { action: string; label: string; variant: 'success' | 'danger' | 'secondary'; needsNote: boolean }[]> = {
  REGISTRATION_STARTED: [{ action: 'reject', label: 'Ablehnen', variant: 'danger', needsNote: true }],
  DOCUMENTS_MISSING: [{ action: 'reject', label: 'Ablehnen', variant: 'danger', needsNote: true }],
  IN_REVIEW: [
    { action: 'approve', label: 'Freigeben', variant: 'success', needsNote: false },
    { action: 'request_documents', label: 'Unterlagen nachfordern', variant: 'secondary', needsNote: true },
    { action: 'reject', label: 'Ablehnen', variant: 'danger', needsNote: true },
  ],
  APPROVED: [{ action: 'block', label: 'Sperren', variant: 'danger', needsNote: true }],
  REJECTED: [{ action: 'reopen', label: 'Erneut prüfen', variant: 'secondary', needsNote: false }],
  BLOCKED: [{ action: 'unblock', label: 'Entsperren', variant: 'success', needsNote: false }],
};

export function CompanyAdminDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['admin-company', id], queryFn: () => api<CompanyDetailData>(`/admin/companies/${id}`) });
  const stats = useQuery({ queryKey: ['admin-company-stats', id], queryFn: () => api<{ stats: Record<string, number | null> & { kpis?: Record<string, number | null> } }>(`/admin/stats/companies/${id}`) });
  const [note, setNote] = useState('');
  const [bidding, setBidding] = useState<BiddingStatus | ''>('');
  const [blockedUntil, setBlockedUntil] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [userOpen, setUserOpen] = useState(false);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setNote('');
      await q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <QueryState query={q}>
      {q.data &&
        (() => {
          const c = q.data;
          const s = stats.data?.stats;
          return (
            <div className="space-y-4">
              <PageHeader back={c.type === 'DEALER' ? '/admin/haendler' : '/admin/autohaeuser'} title={`${c.name} ${c.legalForm}`} subtitle={c.type === 'DEALER' ? 'Händler / Käufer' : 'Autohaus / Einlieferer'} actions={statusBadge(COMPANY_STATUS_LABELS, c.status)} />
              <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
                <div className="space-y-4">
                  <Card title="Firmendaten">
                    <DescriptionList
                      cols={3}
                      items={[
                        ['Anschrift', `${c.street} ${c.houseNumber}, ${c.zip} ${c.city}`],
                        ['Ansprechpartner', `${c.contactFirstName} ${c.contactLastName}`],
                        ['Telefon', c.contactPhone],
                        ['E-Mail', c.contactEmail],
                        ['Website', c.website ?? '–'],
                        ['Handelsregister', c.registerNumber ?? '–'],
                        ['USt-ID', c.vatId ?? '–'],
                        [c.type === 'DEALER' ? 'Gewerbeart' : 'Marken', c.type === 'DEALER' ? (c.tradeType ?? '–') : c.brands.join(', ') || '–'],
                        ['IBAN', c.bankIban ?? '–'],
                        ['Registriert', formatDateTimeDe(c.createdAt)],
                        ['Geprüft', formatDateTimeDe(c.reviewedAt)],
                        ['Händlergruppen', c.groups.map((g) => g.name).join(', ') || '–'],
                      ]}
                    />
                    {c.reviewNote && <Alert tone="info" className="mt-3">Letzte Prüfnotiz: {c.reviewNote}</Alert>}
                  </Card>
                  <Card title="Nachweise">
                    {c.documents.length === 0 ? (
                      <Alert tone="warning">Kein Gewerbenachweis hochgeladen.</Alert>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {c.documents.map((d) => (
                          <li key={d.id} className="flex items-center justify-between py-2 text-sm">
                            <a href={`/api/v1/admin/companies/${c.id}/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-brand-700 hover:underline">
                              <FileText className="h-4 w-4" aria-hidden /> {COMPANY_DOCUMENT_KIND_LABELS[d.kind]} – {d.fileName}
                            </a>
                            <span className="text-xs text-slate-500">
                              {(d.sizeBytes / 1024).toFixed(0)} KB · {formatDateTimeDe(d.createdAt)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card title="Benutzer" actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" />} onClick={() => setUserOpen(true)}>Benutzer anlegen</Button>} padded={false}>
                    <Table head={['Name', 'E-Mail', 'Rolle', 'Status', 'Letzte Anmeldung']} className="rounded-none border-0">
                      {c.users.map((u) => (
                        <tr key={u.id}>
                          <Td>
                            {u.firstName} {u.lastName}
                            {u.jobTitle && <span className="block text-xs text-slate-500">{u.jobTitle}</span>}
                          </Td>
                          <Td>{u.email}</Td>
                          <Td>{COMPANY_ROLE_LABELS[u.companyRole]}</Td>
                          <Td>{u.isActive ? <StatusBadge label="Aktiv" tone="success" /> : <StatusBadge label="Gesperrt" tone="danger" />}</Td>
                          <Td>{formatDateTimeDe(u.lastLoginAt)}</Td>
                        </tr>
                      ))}
                    </Table>
                  </Card>
                  {s && (
                    <Card title="Kennzahlen">
                      {c.type === 'DEALER' ? (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                          <KpiCard label="Gebote" value={fmtNum(s.bids as number)} />
                          <KpiCard label="Auktionen" value={fmtNum(s.auctionsParticipated as number)} />
                          <KpiCard label="Käufe" value={fmtNum(s.purchases as number)} />
                          <KpiCard label="Kaufquote" value={fmtPct(s.purchaseRate as number | null)} />
                          <KpiCard label="Einkaufsvolumen" value={formatEuro(s.purchaseVolume as number, { whole: true })} />
                          <KpiCard label="Ø Kaufpreis" value={formatEuro(s.avgPurchasePrice as number | null, { whole: true })} />
                          <KpiCard label="Offene Zahlungen" value={`${fmtNum(s.openPayments as number)} (${formatEuro(s.openPaymentAmount as number, { whole: true })})`} />
                          <KpiCard label="Stornierungen / Reklamationen" value={`${fmtNum(s.cancellations as number)} / ${fmtNum(s.complaints as number)}`} />
                        </div>
                      ) : (
                        s.kpis && (
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <KpiCard label="Fahrzeuge gesamt" value={fmtNum(s.kpis.vehiclesTotal)} />
                            <KpiCard label="Verkauft" value={fmtNum(s.kpis.sold)} />
                            <KpiCard label="Verkaufsquote" value={fmtPct(s.kpis.saleRate)} />
                            <KpiCard label="Gesamtverkaufswert" value={formatEuro(s.kpis.totalSales, { whole: true })} />
                          </div>
                        )
                      )}
                    </Card>
                  )}
                </div>
                <div className="space-y-4">
                  <Card title="Prüfung und Freigabe">
                    <Field label="Begründung / Notiz" hint="Pflicht bei Ablehnung, Sperrung und Nachforderung">
                      <Input value={note} onChange={(e) => setNote(e.target.value)} />
                    </Field>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {ACTIONS[c.status].map((a) => (
                        <Button key={a.action} size="sm" variant={a.variant} disabled={a.needsNote && note.trim().length < 3} loading={busy === a.action} onClick={() => run(a.action, () => api(`/admin/companies/${c.id}/status`, { method: 'POST', body: { action: a.action, note: note || null } }))}>
                          {a.label}
                        </Button>
                      ))}
                    </div>
                    {c.status === 'IN_REVIEW' && c.documents.length === 0 && <Alert tone="warning" className="mt-3">Vor der Freigabe Gewerbenachweis prüfen – es liegt keiner vor.</Alert>}
                  </Card>
                  {c.type === 'DEALER' && (
                    <Card title="Bieterstatus">
                      <p className="mb-2 text-sm">Aktuell: {statusBadge(BIDDING_STATUS_LABELS, c.verification?.biddingStatus ?? 'VIEW_ONLY')}</p>
                      {c.verification?.blockedUntil && <p className="mb-2 text-xs text-slate-600">Gesperrt bis {formatDateTimeDe(c.verification.blockedUntil)}</p>}
                      <Field label="Neuer Status">
                        <Select value={bidding} onChange={(e) => setBidding(e.target.value as BiddingStatus)}>
                          <option value="">Bitte wählen</option>
                          {BIDDING_STATUSES.map((b) => (
                            <option key={b} value={b}>
                              {BIDDING_STATUS_LABELS[b][0]}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {bidding === 'TEMP_BLOCKED' && (
                        <Field label="Gesperrt bis" className="mt-2">
                          <Input type="datetime-local" value={blockedUntil || isoToLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString())} onChange={(e) => setBlockedUntil(e.target.value)} />
                        </Field>
                      )}
                      <Button
                        size="sm"
                        className="mt-3"
                        disabled={!bidding}
                        loading={busy === 'bidding'}
                        onClick={() =>
                          run('bidding', () =>
                            api(`/admin/companies/${c.id}/bidding-status`, {
                              method: 'POST',
                              body: { status: bidding, note: note || null, blockedUntil: bidding === 'TEMP_BLOCKED' ? localInputToIso(blockedUntil || isoToLocalInput(new Date(Date.now() + 7 * 86400_000).toISOString())) : null },
                            }),
                          )
                        }
                      >
                        Bieterstatus setzen
                      </Button>
                      <p className="mt-2 text-xs text-slate-500">Bei Sperrung werden aktive Bietagenten sofort gestoppt. Abgegebene Gebote bleiben verbindlich.</p>
                    </Card>
                  )}
                  <ErrorAlert error={error} />
                </div>
              </div>
              <CompanyUserDialog companyId={c.id} open={userOpen} onClose={() => setUserOpen(false)} onCreated={() => void q.refetch()} />
            </div>
          );
        })()}
    </QueryState>
  );
}

function CompanyUserDialog({ companyId, open, onClose, onCreated }: { companyId: string; open: boolean; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', companyRole: 'OWNER' as CompanyRole });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: { ...f, phone: f.phone || null, platformRole: 'USER', companyId } });
      onCreated();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Benutzer für Unternehmen anlegen" footer={<Button onClick={submit} loading={busy}>Anlegen</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vorname" required error={fe.firstName}><Input value={f.firstName} onChange={(e) => setF((o) => ({ ...o, firstName: e.target.value }))} /></Field>
        <Field label="Nachname" required error={fe.lastName}><Input value={f.lastName} onChange={(e) => setF((o) => ({ ...o, lastName: e.target.value }))} /></Field>
        <Field label="E-Mail" required error={fe.email}><Input type="email" value={f.email} onChange={(e) => setF((o) => ({ ...o, email: e.target.value }))} /></Field>
        <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF((o) => ({ ...o, phone: e.target.value }))} /></Field>
        <Field label="Rolle">
          <Select value={f.companyRole} onChange={(e) => setF((o) => ({ ...o, companyRole: e.target.value as CompanyRole }))}>
            {(['OWNER', 'MANAGER', 'MEMBER'] as CompanyRole[]).map((r) => <option key={r} value={r}>{COMPANY_ROLE_LABELS[r]}</option>)}
          </Select>
        </Field>
        <Field label="Startpasswort" required error={fe.password}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((o) => ({ ...o, password: e.target.value }))} /></Field>
      </div>
      <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
    </Modal>
  );
}
