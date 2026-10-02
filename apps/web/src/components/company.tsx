'use client';

import { FileText, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BIDDING_STATUS_LABELS,
  COMPANY_DOCUMENT_KIND_LABELS,
  COMPANY_ROLE_LABELS,
  COMPANY_ROLES,
  COMPANY_STATUS_LABELS,
  formatDateTimeDe,
  type BiddingStatus,
  type CompanyDocumentKind,
  type CompanyRole,
  type CompanyStatus,
} from '@sd/shared';
import { api, fieldErrors } from '@/lib/api';
import { isManager, useMe } from '@/lib/session';
import { Alert, Button, Card, ErrorAlert, Field, Input, Modal, PageHeader, QueryState, Select, StatusBadge, statusBadge, Table, Td } from './ui';

interface CompanyData {
  id: string;
  type: 'DEALERSHIP' | 'DEALER';
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
  biddingStatus: BiddingStatus | null;
  documents: { id: string; kind: CompanyDocumentKind; fileName: string; sizeBytes: number; createdAt: string }[];
}

export function CompanyProfile({ withUsers = false }: { withUsers?: boolean }) {
  const me = useMe();
  const q = useQuery({ queryKey: ['company'], queryFn: () => api<CompanyData>('/company') });
  const manager = isManager(me.data);
  return (
    <div className="space-y-4">
      <PageHeader title="Firmendaten" />
      <QueryState query={q}>{q.data && <CompanyForm data={q.data} editable={manager} onSaved={() => void q.refetch()} />}</QueryState>
      {withUsers && <CompanyUsers />}
    </div>
  );
}

function CompanyForm({ data, editable, onSaved }: { data: CompanyData; editable: boolean; onSaved: () => void }) {
  const [v, setV] = useState({ ...data, brands: data.brands.join(', '), website: data.website ?? '', registerNumber: data.registerNumber ?? '', vatId: data.vatId ?? '', tradeType: data.tradeType ?? '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [docKind, setDocKind] = useState<CompanyDocumentKind>('TRADE_LICENSE');
  const [file, setFile] = useState<File | null>(null);
  const fe = fieldErrors(error);
  useEffect(() => setSaved(false), [v]);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/company', {
        method: 'PATCH',
        body: {
          name: v.name,
          legalForm: v.legalForm,
          street: v.street,
          houseNumber: v.houseNumber,
          zip: v.zip,
          city: v.city,
          website: v.website || null,
          registerNumber: v.registerNumber || null,
          vatId: v.vatId || null,
          brands: v.brands.split(',').map((b) => b.trim()).filter(Boolean),
          tradeType: v.tradeType || null,
          contactFirstName: v.contactFirstName,
          contactLastName: v.contactLastName,
          contactPhone: v.contactPhone,
          contactEmail: v.contactEmail,
        },
      });
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const uploadDoc = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('kind', docKind);
      fd.append('file', file);
      await api('/company/documents', { method: 'POST', body: fd });
      setFile(null);
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const fields: [keyof typeof v, string, boolean?][] = [
    ['name', 'Firmenname', true],
    ['legalForm', 'Rechtsform', true],
    ['street', 'Straße', true],
    ['houseNumber', 'Hausnummer', true],
    ['zip', 'PLZ', true],
    ['city', 'Ort', true],
    ['website', 'Website'],
    ['registerNumber', 'Handelsregister'],
    ['vatId', 'Umsatzsteuer-ID', data.type === 'DEALER'],
    ['contactFirstName', 'Ansprechpartner Vorname', true],
    ['contactLastName', 'Ansprechpartner Nachname', true],
    ['contactPhone', 'Telefon', true],
    ['contactEmail', 'E-Mail', true],
  ];
  return (
    <>
      <Card
        title={data.name}
        actions={
          <div className="flex gap-2">
            {statusBadge(COMPANY_STATUS_LABELS, data.status)}
            {data.biddingStatus && statusBadge(BIDDING_STATUS_LABELS, data.biddingStatus)}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, label, req]) => (
            <Field key={k} label={label} required={req} error={fe[k as string]}>
              <Input value={String(v[k] ?? '')} onChange={set(k)} disabled={!editable} />
            </Field>
          ))}
          {data.type === 'DEALERSHIP' ? (
            <Field label="Marken / Vertragspartnerschaften" className="sm:col-span-2">
              <Input value={v.brands} onChange={set('brands')} disabled={!editable} />
            </Field>
          ) : (
            <>
              <Field label="Gewerbeart">
                <Input value={v.tradeType} onChange={set('tradeType')} disabled={!editable} />
              </Field>
              <Field label="Bankverbindung" hint="Aus Sicherheitsgründen nur maskiert angezeigt">
                <Input value={data.bankIban ?? '–'} disabled />
              </Field>
            </>
          )}
        </div>
        {editable && (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save} loading={busy}>
              Speichern
            </Button>
            {saved && <span className="text-sm text-emerald-700">Gespeichert.</span>}
          </div>
        )}
        {!editable && <p className="mt-3 text-xs text-slate-500">Änderungen sind der Firmenleitung vorbehalten.</p>}
        <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
      </Card>
      <Card title="Nachweise">
        <ul className="mb-4 divide-y divide-slate-100">
          {data.documents.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <a href={`/api/v1/company/documents/${d.id}/file`} className="flex items-center gap-2 text-brand-700 hover:underline">
                <FileText className="h-4 w-4" aria-hidden /> {COMPANY_DOCUMENT_KIND_LABELS[d.kind]} – {d.fileName}
              </a>
              <span className="text-xs text-slate-500">{formatDateTimeDe(d.createdAt)}</span>
            </li>
          ))}
          {data.documents.length === 0 && <li className="py-2 text-sm text-slate-500">Keine Nachweise hochgeladen.</li>}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Art">
              <Select value={docKind} onChange={(e) => setDocKind(e.target.value as CompanyDocumentKind)}>
                {(Object.keys(COMPANY_DOCUMENT_KIND_LABELS) as CompanyDocumentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {COMPANY_DOCUMENT_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" aria-label="Datei auswählen" />
            <Button variant="secondary" onClick={uploadDoc} disabled={!file} loading={busy}>
              Hochladen
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}

interface CompanyUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  companyRole: CompanyRole;
  jobTitle: string | null;
}

export function CompanyUsers({ standalone }: { standalone?: boolean }) {
  const me = useMe();
  const q = useQuery({ queryKey: ['company-users'], queryFn: () => api<CompanyUser[]>('/company/users') });
  const manager = isManager(me.data);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', jobTitle: '', companyRole: 'MEMBER' as CompanyRole, password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/company/users', { method: 'POST', body: { ...form, phone: form.phone || null, jobTitle: form.jobTitle || null } });
      setOpen(false);
      setForm({ firstName: '', lastName: '', email: '', phone: '', jobTitle: '', companyRole: 'MEMBER', password: '' });
      void q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (u: CompanyUser) => {
    try {
      await api(`/company/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  };

  const content = (
    <Card title="Mitarbeiter" actions={manager && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Mitarbeiter anlegen</Button>}>
      <QueryState query={q}>
        <Table head={['Name', 'E-Mail', 'Funktion', 'Rolle', 'Status', 'Letzte Anmeldung', '']}>
          {q.data?.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.firstName} {u.lastName}
              </Td>
              <Td>{u.email}</Td>
              <Td>{u.jobTitle ?? '–'}</Td>
              <Td>{COMPANY_ROLE_LABELS[u.companyRole]}</Td>
              <Td>{u.isActive ? <StatusBadge label="Aktiv" tone="success" /> : <StatusBadge label="Deaktiviert" tone="neutral" />}</Td>
              <Td>{formatDateTimeDe(u.lastLoginAt)}</Td>
              <Td>
                {manager && u.id !== me.data?.user.id && (
                  <Button size="sm" variant="ghost" onClick={() => toggle(u)}>
                    {u.isActive ? 'Deaktivieren' : 'Aktivieren'}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <ErrorAlert error={!open ? error : null} className="mt-3" />
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Mitarbeiter anlegen"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={create} loading={busy}>
              Anlegen
            </Button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vorname" required error={fe.firstName}>
            <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          </Field>
          <Field label="Nachname" required error={fe.lastName}>
            <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          </Field>
          <Field label="E-Mail" required error={fe.email}>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Telefon" error={fe.phone}>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </Field>
          <Field label="Funktion" hint="z. B. Gebrauchtwagenleiter">
            <Input value={form.jobTitle} onChange={(e) => setForm((f) => ({ ...f, jobTitle: e.target.value }))} />
          </Field>
          <Field label="Rolle" required>
            <Select value={form.companyRole} onChange={(e) => setForm((f) => ({ ...f, companyRole: e.target.value as CompanyRole }))}>
              {COMPANY_ROLES.map((r) => (
                <option key={r} value={r}>
                  {COMPANY_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Startpasswort" required hint="Mindestens 10 Zeichen, Buchstaben und Ziffern" error={fe.password} className="sm:col-span-2">
            <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" />
          </Field>
        </div>
        <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
        <Alert tone="info" className="mt-3">
          Teilen Sie das Startpasswort auf sicherem Weg mit. Der Mitarbeiter kann es nach der Anmeldung ändern.
        </Alert>
      </Modal>
    </Card>
  );
  return standalone ? (
    <div>
      <PageHeader title="Mitarbeiter" />
      {content}
    </div>
  ) : (
    content
  );
}
