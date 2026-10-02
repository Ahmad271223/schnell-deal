'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { AUCTION_STATUS_LABELS, formatDateTimeDe, VEHICLE_STATUS_LABELS, type AuctionStatus, type CatalogStatus, type VehicleStatus } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro } from '@/lib/format';
import type { VehicleRow } from '@/components/vehicles';
import { Alert, Button, Card, ErrorAlert, PageHeader, QueryState, Select, statusBadge, Table, Td } from '@/components/ui';

interface CatalogDetail {
  id: string;
  name: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: CatalogStatus;
  vehicles: { vehicleId: string; sort: number; internalNumber: string; make: string | null; model: string | null; status: VehicleStatus; auction: { id: string; number: string; status: AuctionStatus; startsAt: string; endsAt: string; currentBid: number | null } | null }[];
}

export default function CatalogDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useQuery({ queryKey: ['catalog', id], queryFn: () => api<CatalogDetail>(`/admin/catalogs/${id}`) });
  const pool = useQuery({ queryKey: ['vehicles', 'APPROVED,SCHEDULED,UNSOLD', ''], queryFn: () => api<VehicleRow[]>('/vehicles?status=APPROVED,SCHEDULED,UNSOLD') });
  const [order, setOrder] = useState<string[]>([]);
  const [add, setAdd] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (q.data) setOrder(q.data.vehicles.map((v) => v.vehicleId));
  }, [q.data]);
  const byId = new Map<string, { label: string; status?: VehicleStatus; auction?: CatalogDetail['vehicles'][number]['auction'] }>();
  for (const v of pool.data ?? []) byId.set(v.id, { label: `${v.internalNumber} · ${v.make ?? ''} ${v.model ?? ''}`, status: v.status });
  for (const v of q.data?.vehicles ?? []) byId.set(v.vehicleId, { label: `${v.internalNumber} · ${v.make ?? ''} ${v.model ?? ''}`, status: v.status, auction: v.auction });
  const move = (i: number, d: number) => setOrder((o) => {
    const n = [...o];
    const [x] = n.splice(i, 1);
    n.splice(i + d, 0, x!);
    return n;
  });
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await api(`/admin/catalogs/${id}/vehicles`, { method: 'PUT', body: { vehicleIds: order } });
      setSaved(true);
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  };
  const setStatus = async (status: CatalogStatus) => {
    await api(`/admin/catalogs/${id}/status`, { method: 'POST', body: { status } });
    void q.refetch();
  };
  return (
    <QueryState query={q}>
      {q.data && (
        <div className="space-y-4">
          <PageHeader
            back="/admin/kataloge"
            title={q.data.name}
            subtitle={`${formatDateTimeDe(q.data.startsAt)} – ${formatDateTimeDe(q.data.endsAt)}`}
            actions={
              <Select value={q.data.status} onChange={(e) => void setStatus(e.target.value as CatalogStatus)} aria-label="Katalogstatus" className="w-48">
                <option value="DRAFT">Entwurf</option>
                <option value="PUBLISHED">Veröffentlicht</option>
                <option value="CLOSED">Geschlossen</option>
              </Select>
            }
          />
          {q.data.description && <p className="text-sm text-slate-600">{q.data.description}</p>}
          <Card title={`Fahrzeuge (${order.length})`}>
            <Table head={['#', 'Fahrzeug', 'Status', 'Auktion', '']}>
              {order.map((vid, i) => {
                const info = byId.get(vid);
                return (
                  <tr key={vid}>
                    <Td>{i + 1}</Td>
                    <Td>
                      <Link href={`/admin/fahrzeuge/${vid}`} className="text-brand-700 hover:underline">
                        {info?.label ?? vid}
                      </Link>
                    </Td>
                    <Td>{info?.status ? statusBadge(VEHICLE_STATUS_LABELS, info.status) : '–'}</Td>
                    <Td>
                      {info?.auction ? (
                        <Link href={`/admin/auktionen/${info.auction.id}`} className="flex items-center gap-2 text-brand-700 hover:underline">
                          {info.auction.number} {statusBadge(AUCTION_STATUS_LABELS, info.auction.status)} {info.auction.currentBid !== null && formatEuro(info.auction.currentBid, { whole: true })}
                        </Link>
                      ) : (
                        <Link href={`/admin/auktionen/neu?vehicleId=${vid}`} className="text-sm text-brand-700 hover:underline">
                          Auktion anlegen
                        </Link>
                      )}
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        <button className="rounded p-1 text-slate-500 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Nach oben">
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button className="rounded p-1 text-slate-500 disabled:opacity-30" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label="Nach unten">
                          <ArrowDown className="h-4 w-4" />
                        </button>
                        <button className="rounded p-1 text-red-600" onClick={() => setOrder((o) => o.filter((x) => x !== vid))} aria-label="Entfernen">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Select value={add} onChange={(e) => setAdd(e.target.value)} className="max-w-md" aria-label="Fahrzeug hinzufügen">
                <option value="">Freigegebenes Fahrzeug hinzufügen …</option>
                {(pool.data ?? [])
                  .filter((v) => !order.includes(v.id))
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.internalNumber} · {v.make} {v.model} · {v.companyName}
                    </option>
                  ))}
              </Select>
              <Button variant="secondary" disabled={!add} onClick={() => (setOrder((o) => [...o, add]), setAdd(''))}>
                Hinzufügen
              </Button>
              <Button onClick={save}>Reihenfolge und Fahrzeuge speichern</Button>
              {saved && <span className="text-sm text-emerald-700">Gespeichert.</span>}
            </div>
            <Alert tone="info" className="mt-3">Jedes Fahrzeug kann nur in einer offenen Auktion stehen. Die Auktionen werden pro Fahrzeug mit eigenen Parametern angelegt.</Alert>
            <ErrorAlert error={error} className="mt-3" />
          </Card>
        </div>
      )}
    </QueryState>
  );
}
