'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeDe, type CatalogStatus } from '@sd/shared';
import { api, fieldErrors } from '@/lib/api';
import { localInputToIso } from '@/lib/format';
import { Button, EmptyState, ErrorAlert, Field, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Table, Td, Textarea } from '@/components/ui';

const STATUS: Record<CatalogStatus, [string, 'neutral' | 'success' | 'info']> = { DRAFT: ['Entwurf', 'neutral'], PUBLISHED: ['Veröffentlicht', 'success'], CLOSED: ['Geschlossen', 'info'] };

interface CatalogRow {
  id: string;
  name: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: CatalogStatus;
  dealerGroupName: string | null;
  vehicleCount: number;
}

export default function CatalogsPage() {
  const q = useQuery({ queryKey: ['catalogs'], queryFn: () => api<CatalogRow[]>('/admin/catalogs') });
  const groups = useQuery({ queryKey: ['dealer-groups'], queryFn: () => api<{ id: string; name: string }[]>('/admin/dealer-groups') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', description: '', startsAt: '', endsAt: '', dealerGroupId: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/admin/catalogs', {
        method: 'POST',
        body: { name: f.name, description: f.description || null, startsAt: f.startsAt ? localInputToIso(f.startsAt) : null, endsAt: f.endsAt ? localInputToIso(f.endsAt) : null, dealerGroupId: f.dealerGroupId || null },
      });
      setOpen(false);
      setF({ name: '', description: '', startsAt: '', endsAt: '', dealerGroupId: '' });
      void q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Kataloge" subtitle="Fahrzeuge zu Auktionsterminen bündeln, z. B. „Hannover Händlerauktion – 05.10.2026“" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Katalog anlegen</Button>} />
      <QueryState query={q} empty={<EmptyState title="Noch keine Kataloge" />}>
        <Table head={['Katalog', 'Zeitraum', 'Händlergruppe', 'Fahrzeuge', 'Status']}>
          {q.data?.map((c) => (
            <tr key={c.id}>
              <Td>
                <Link href={`/admin/kataloge/${c.id}`} className="font-medium text-brand-700 hover:underline">
                  {c.name}
                </Link>
              </Td>
              <Td>
                {formatDateTimeDe(c.startsAt)} – {formatDateTimeDe(c.endsAt)}
              </Td>
              <Td>{c.dealerGroupName ?? 'Alle Händler'}</Td>
              <Td>{c.vehicleCount}</Td>
              <Td>
                <StatusBadge label={STATUS[c.status][0]} tone={STATUS[c.status][1]} />
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title="Katalog anlegen" footer={<Button onClick={create} loading={busy}>Anlegen</Button>}>
        <div className="grid gap-3">
          <Field label="Katalogname" required error={fe.name}>
            <Input value={f.name} onChange={(e) => setF((o) => ({ ...o, name: e.target.value }))} />
          </Field>
          <Field label="Beschreibung">
            <Textarea value={f.description} onChange={(e) => setF((o) => ({ ...o, description: e.target.value }))} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start">
              <Input type="datetime-local" value={f.startsAt} onChange={(e) => setF((o) => ({ ...o, startsAt: e.target.value }))} />
            </Field>
            <Field label="Ende">
              <Input type="datetime-local" value={f.endsAt} onChange={(e) => setF((o) => ({ ...o, endsAt: e.target.value }))} />
            </Field>
          </div>
          <Field label="Händlergruppe">
            <Select value={f.dealerGroupId} onChange={(e) => setF((o) => ({ ...o, dealerGroupId: e.target.value }))}>
              <option value="">Alle Händler</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorAlert error={Object.keys(fe).length ? null : error} />
        </div>
      </Modal>
    </div>
  );
}
