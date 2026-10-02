'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { COMPLAINT_STATUS_LABELS, COMPLAINT_STATUSES, DEAL_STATUS_LABELS, formatDateTimeDe, type ComplaintStatus, type DealStatus } from '@sd/shared';
import { api } from '@/lib/api';
import { Button, EmptyState, ErrorAlert, Field, Modal, PageHeader, QueryState, Select, statusBadge, Table, Td, Textarea } from '@/components/ui';

interface ComplaintRow {
  id: string;
  reason: string;
  description: string;
  status: ComplaintStatus;
  resolution: string | null;
  createdAt: string;
  resolvedAt: string | null;
  dealId: string;
  dealNumber: string;
  dealStatus: DealStatus;
  buyer: string;
  seller: string;
}

export default function ComplaintsPage() {
  const q = useQuery({ queryKey: ['admin-complaints'], queryFn: () => api<ComplaintRow[]>('/admin/complaints') });
  const [edit, setEdit] = useState<ComplaintRow | null>(null);
  const [status, setStatus] = useState<ComplaintStatus>('IN_REVIEW');
  const [resolution, setResolution] = useState('');
  const [dealStatus, setDealStatus] = useState<DealStatus | ''>('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/complaints/${edit.id}/resolve`, { method: 'POST', body: { status, resolution: resolution || null, dealStatus: dealStatus || undefined } });
      setEdit(null);
      void q.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader title="Reklamationen" />
      <QueryState query={q} empty={<EmptyState title="Keine Reklamationen" />}>
        <Table head={['Eingang', 'Deal', 'Käufer', 'Verkäufer', 'Grund', 'Status', 'Deal-Status', '']}>
          {q.data?.map((c) => (
            <tr key={c.id}>
              <Td>{formatDateTimeDe(c.createdAt)}</Td>
              <Td>
                <Link href={`/admin/verkaeufe/${c.dealId}`} className="text-brand-700 hover:underline">
                  {c.dealNumber}
                </Link>
              </Td>
              <Td>{c.buyer}</Td>
              <Td>{c.seller}</Td>
              <Td className="max-w-xs whitespace-normal">
                <span className="font-medium">{c.reason}</span>
                <span className="block text-xs text-slate-600">{c.description}</span>
              </Td>
              <Td>{statusBadge(COMPLAINT_STATUS_LABELS, c.status)}</Td>
              <Td>{statusBadge(DEAL_STATUS_LABELS, c.dealStatus)}</Td>
              <Td>
                {(c.status === 'OPEN' || c.status === 'IN_REVIEW') && (
                  <Button size="sm" variant="secondary" onClick={() => (setEdit(c), setStatus('IN_REVIEW'), setResolution(c.resolution ?? ''), setDealStatus(''))}>
                    Bearbeiten
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Reklamation ${edit?.dealNumber ?? ''}`} footer={<Button onClick={save} loading={busy}>Speichern</Button>}>
        {edit && (
          <div className="space-y-3">
            <p className="text-sm">
              <strong>{edit.reason}</strong>: {edit.description}
            </p>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as ComplaintStatus)}>
                {COMPLAINT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {COMPLAINT_STATUS_LABELS[s][0]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lösung / Stellungnahme">
              <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} />
            </Field>
            {(status === 'RESOLVED' || status === 'REJECTED') && (
              <Field label="Deal danach" hint="Leer = vorheriger Status vor der Reklamation">
                <Select value={dealStatus} onChange={(e) => setDealStatus(e.target.value as DealStatus)}>
                  <option value="">Vorheriger Status</option>
                  <option value="PAYMENT_PENDING">Zahlung ausstehend</option>
                  <option value="PAID">Bezahlt</option>
                  <option value="READY_FOR_PICKUP">Abholbereit</option>
                  <option value="PICKED_UP">Abgeholt</option>
                  <option value="COMPLETED">Abgeschlossen</option>
                  <option value="CANCELLED">Stornieren</option>
                </Select>
              </Field>
            )}
            <ErrorAlert error={error} />
          </div>
        )}
      </Modal>
    </div>
  );
}
