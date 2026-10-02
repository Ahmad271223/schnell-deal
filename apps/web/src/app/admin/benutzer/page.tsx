'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { COMPANY_ROLE_LABELS, formatDateTimeDe, PLATFORM_ROLE_LABELS, PLATFORM_ROLES, type CompanyRole, type PlatformRole } from '@sd/shared';
import { api, fieldErrors } from '@/lib/api';
import { useMe } from '@/lib/session';
import { Button, ErrorAlert, Field, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Table, Td } from '@/components/ui';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  platformRole: PlatformRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  companyName: string | null;
  companyType: 'DEALERSHIP' | 'DEALER' | null;
  companyRole: CompanyRole | null;
}

export default function UsersPage() {
  const me = useMe();
  const [role, setRole] = useState<PlatformRole | ''>('');
  const [search, setSearch] = useState('');
  const q = useQuery({ queryKey: ['admin-users', role, search], queryFn: () => api<UserRow[]>(`/admin/users?${new URLSearchParams({ ...(role ? { role } : {}), ...(search ? { q: search } : {}) })}`) });
  const [open, setOpen] = useState(false);
  const [reset, setReset] = useState<UserRow | null>(null);
  const [pw, setPw] = useState('');
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '', platformRole: 'ADMIN' as PlatformRole });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const superadmin = me.data?.user.platformRole === 'SUPERADMIN';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: { ...f, phone: f.phone || null } });
      setOpen(false);
      void q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (u: UserRow) => {
    setError(null);
    try {
      await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  };
  const doReset = async () => {
    if (!reset) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/users/${reset.id}`, { method: 'PATCH', body: { password: pw } });
      setReset(null);
      setPw('');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Benutzer" subtitle="Alle Konten der Plattform. Firmenbenutzer werden über das jeweilige Unternehmen angelegt." actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Plattform-Benutzer anlegen</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input placeholder="Suche Name oder E-Mail" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={role} onChange={(e) => setRole(e.target.value as PlatformRole)} className="w-56">
          <option value="">Alle Rollen</option>
          {PLATFORM_ROLES.map((r) => (
            <option key={r} value={r}>
              {PLATFORM_ROLE_LABELS[r]}
            </option>
          ))}
        </Select>
      </div>
      <ErrorAlert error={!open && !reset ? error : null} className="mb-3" />
      <QueryState query={q}>
        <Table head={['Name', 'E-Mail', 'Rolle', 'Unternehmen', 'Status', 'Letzte Anmeldung', '']}>
          {q.data?.map((u) => (
            <tr key={u.id}>
              <Td>
                {u.firstName} {u.lastName}
              </Td>
              <Td>{u.email}</Td>
              <Td>{PLATFORM_ROLE_LABELS[u.platformRole]}</Td>
              <Td>{u.companyName ? `${u.companyName} (${u.companyRole ? COMPANY_ROLE_LABELS[u.companyRole] : ''})` : '–'}</Td>
              <Td>{u.isActive ? <StatusBadge label="Aktiv" tone="success" /> : <StatusBadge label="Gesperrt" tone="danger" />}</Td>
              <Td>{formatDateTimeDe(u.lastLoginAt)}</Td>
              <Td>
                {u.id !== me.data?.user.id && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => toggle(u)}>
                      {u.isActive ? 'Sperren' : 'Entsperren'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => (setReset(u), setPw(''))}>
                      Passwort zurücksetzen
                    </Button>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title="Plattform-Benutzer anlegen" footer={<Button onClick={create} loading={busy}>Anlegen</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Vorname" required error={fe.firstName}><Input value={f.firstName} onChange={(e) => setF((o) => ({ ...o, firstName: e.target.value }))} /></Field>
          <Field label="Nachname" required error={fe.lastName}><Input value={f.lastName} onChange={(e) => setF((o) => ({ ...o, lastName: e.target.value }))} /></Field>
          <Field label="E-Mail" required error={fe.email}><Input type="email" value={f.email} onChange={(e) => setF((o) => ({ ...o, email: e.target.value }))} /></Field>
          <Field label="Telefon"><Input value={f.phone} onChange={(e) => setF((o) => ({ ...o, phone: e.target.value }))} /></Field>
          <Field label="Rolle" required hint={superadmin ? undefined : 'Administratoren kann nur ein Superadmin anlegen'}>
            <Select value={f.platformRole} onChange={(e) => setF((o) => ({ ...o, platformRole: e.target.value as PlatformRole }))}>
              {(['ADMIN', 'SUPERADMIN', 'INSPECTOR'] as PlatformRole[]).map((r) => (
                <option key={r} value={r} disabled={!superadmin && r !== 'INSPECTOR'}>
                  {PLATFORM_ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Startpasswort" required error={fe.password}><Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((o) => ({ ...o, password: e.target.value }))} /></Field>
        </div>
        <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`Passwort zurücksetzen: ${reset?.email ?? ''}`} footer={<Button onClick={doReset} loading={busy} disabled={pw.length < 10}>Zurücksetzen</Button>}>
        <Field label="Neues Passwort" hint="Alle Sitzungen des Benutzers werden beendet." error={fe.password}>
          <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
      </Modal>
    </div>
  );
}
