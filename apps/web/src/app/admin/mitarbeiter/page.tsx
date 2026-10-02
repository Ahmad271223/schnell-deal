'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeDe } from '@sd/shared';
import { api, fieldErrors } from '@/lib/api';
import { InspectorsTab } from '@/components/inspector-stats';
import { Button, Card, ErrorAlert, Field, Input, Modal, PageHeader, QueryState, StatusBadge, Table, Td } from '@/components/ui';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export default function InspectorsPage() {
  const q = useQuery({ queryKey: ['admin-users', 'INSPECTOR'], queryFn: () => api<UserRow[]>('/admin/users?role=INSPECTOR') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/users', { method: 'POST', body: { ...f, phone: f.phone || null, platformRole: 'INSPECTOR' } });
      setOpen(false);
      setF({ firstName: '', lastName: '', email: '', phone: '', password: '' });
      void q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (u: UserRow) => {
    await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } });
    void q.refetch();
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Außendienstmitarbeiter" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Mitarbeiter anlegen</Button>} />
      <Card title="Mitarbeiter" padded={false}>
        <QueryState query={q}>
          <Table head={['Name', 'E-Mail', 'Telefon', 'Status', 'Letzte Anmeldung', '']} className="rounded-none border-0">
            {q.data?.map((u) => (
              <tr key={u.id}>
                <Td>
                  {u.firstName} {u.lastName}
                </Td>
                <Td>{u.email}</Td>
                <Td>{u.phone ?? '–'}</Td>
                <Td>{u.isActive ? <StatusBadge label="Aktiv" tone="success" /> : <StatusBadge label="Gesperrt" tone="danger" />}</Td>
                <Td>{formatDateTimeDe(u.lastLoginAt)}</Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => toggle(u)}>
                    {u.isActive ? 'Sperren' : 'Entsperren'}
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        </QueryState>
      </Card>
      <section>
        <h2 className="mb-2 font-semibold">Betriebskennzahlen</h2>
        <InspectorsTab />
      </section>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Außendienstmitarbeiter anlegen"
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
            <Input value={f.firstName} onChange={(e) => setF((o) => ({ ...o, firstName: e.target.value }))} />
          </Field>
          <Field label="Nachname" required error={fe.lastName}>
            <Input value={f.lastName} onChange={(e) => setF((o) => ({ ...o, lastName: e.target.value }))} />
          </Field>
          <Field label="E-Mail" required error={fe.email}>
            <Input type="email" value={f.email} onChange={(e) => setF((o) => ({ ...o, email: e.target.value }))} />
          </Field>
          <Field label="Mobilnummer" error={fe.phone}>
            <Input type="tel" value={f.phone} onChange={(e) => setF((o) => ({ ...o, phone: e.target.value }))} />
          </Field>
          <Field label="Startpasswort" required hint="Mind. 10 Zeichen, Buchstaben und Ziffern" error={fe.password} className="sm:col-span-2">
            <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF((o) => ({ ...o, password: e.target.value }))} />
          </Field>
        </div>
        <ErrorAlert error={Object.keys(fe).length ? null : error} className="mt-3" />
      </Modal>
    </div>
  );
}
