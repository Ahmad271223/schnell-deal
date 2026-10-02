'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_EVENTS, formatDateTimeDe, type AuditEvent } from '@sd/shared';
import { api } from '@/lib/api';
import { localInputToIso } from '@/lib/format';
import { Button, Field, Input, Modal, PageHeader, Pagination, QueryState, Select, Table, Td } from '@/components/ui';

interface AuditRow {
  id: number;
  actorUserId: string | null;
  actorRole: string | null;
  actorEmail: string | null;
  actorName: string | null;
  event: AuditEvent;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export default function AuditPage() {
  const [filters, setFilters] = useState({ event: '', entityType: '', entityId: '', from: '', to: '' });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AuditRow | null>(null);
  const params = new URLSearchParams({ page: String(page) });
  if (applied.event) params.set('event', applied.event);
  if (applied.entityType) params.set('entityType', applied.entityType);
  if (applied.entityId) params.set('entityId', applied.entityId);
  if (applied.from) params.set('from', localInputToIso(applied.from));
  if (applied.to) params.set('to', localInputToIso(applied.to));
  const q = useQuery({ queryKey: ['audit', params.toString()], queryFn: () => api<{ items: AuditRow[]; hasMore: boolean }>(`/admin/audit?${params}`) });
  return (
    <div>
      <PageHeader title="Audit-Log" subtitle="Unveränderliches Protokoll aller relevanten Vorgänge (append-only auf Datenbankebene)." />
      <div className="mb-4 grid gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Ereignis">
          <Select value={filters.event} onChange={(e) => setFilters((f) => ({ ...f, event: e.target.value }))}>
            <option value="">Alle</option>
            {AUDIT_EVENTS.map((ev) => (
              <option key={ev} value={ev}>
                {ev}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Objektart">
          <Select value={filters.entityType} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}>
            <option value="">Alle</option>
            {['user', 'company', 'inspection_request', 'vehicle', 'auction', 'deal', 'legal_document', 'settings', 'catalog', 'dealer_group', 'job'].map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Objekt-ID">
          <Input value={filters.entityId} onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value.trim() }))} />
        </Field>
        <Field label="Von">
          <Input type="datetime-local" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </Field>
        <Field label="Bis">
          <Input type="datetime-local" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        <div className="flex items-end">
          <Button className="w-full" onClick={() => (setApplied(filters), setPage(1))}>
            Filtern
          </Button>
        </div>
      </div>
      <QueryState query={q}>
        <Table head={['Zeitpunkt', 'Ereignis', 'Benutzer', 'Rolle', 'Objekt', 'IP', '']}>
          {q.data?.items.map((r) => (
            <tr key={r.id}>
              <Td className="text-xs">{formatDateTimeDe(r.createdAt)}</Td>
              <Td className="font-mono text-xs">{r.event}</Td>
              <Td className="text-xs">{r.actorEmail ?? (r.actorRole === 'SYSTEM' || r.actorRole === 'PROXY_AGENT' ? r.actorRole : '–')}</Td>
              <Td className="text-xs">{r.actorRole}</Td>
              <Td className="text-xs">
                {r.entityType} <span className="font-mono text-slate-500">{r.entityId?.slice(0, 8)}</span>
              </Td>
              <Td className="text-xs">{r.ip ?? '–'}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                  Details
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
        {q.data && <Pagination page={page} hasMore={q.data.hasMore} onChange={setPage} />}
      </QueryState>
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail ? `${detail.event} · ${formatDateTimeDe(detail.createdAt)}` : ''} size="lg">
        {detail && (
          <div className="space-y-3 text-sm">
            <p>
              Objekt: {detail.entityType} <span className="font-mono">{detail.entityId}</span>
            </p>
            <p>
              Benutzer: {detail.actorName ?? '–'} ({detail.actorEmail ?? detail.actorRole}) · IP {detail.ip ?? '–'}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Vorheriger Wert</p>
                <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(detail.oldValue, null, 2)}</pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Neuer Wert</p>
                <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(detail.newValue, null, 2)}</pre>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
