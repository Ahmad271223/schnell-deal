'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useChannel } from '@/lib/realtime';
import type { InspectionRequestItem } from '@/lib/types';
import { AssignDialog, InspectorColumn, RequestCard, RequestMap, WeekCalendar, type Inspector } from '@/components/dispatch';
import { EmptyState, PageHeader, QueryState, Tabs } from '@/components/ui';

type View = 'today' | 'tomorrow' | 'week' | 'calendar' | 'map' | 'unplanned' | 'done' | 'cancelled';

function mondayOf(d: Date): Date {
  const local = new Date(d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) + 'T00:00:00');
  const day = (local.getDay() + 6) % 7;
  return new Date(local.getTime() - day * 86400_000);
}

export default function DispatchPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<View>('unplanned');
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [dialog, setDialog] = useState<{ request: InspectionRequestItem; mode: 'assign' | 'schedule' | 'cancel'; inspectorId?: string } | null>(null);

  const fmt = (d: Date) => d.toLocaleDateString('sv-SE');
  const apiView = view === 'calendar' ? `range&from=${fmt(weekStart)}&to=${fmt(new Date(weekStart.getTime() + 6 * 86400_000))}` : view === 'map' ? 'open' : view;
  const requests = useQuery({ queryKey: ['dispatch', apiView], queryFn: () => api<InspectionRequestItem[]>(`/inspection-requests?view=${apiView}`), refetchInterval: 30_000 });
  const openAll = useQuery({ queryKey: ['dispatch', 'open'], queryFn: () => api<InspectionRequestItem[]>('/inspection-requests?view=open'), refetchInterval: 30_000 });
  const inspectors = useQuery({ queryKey: ['inspectors'], queryFn: () => api<Inspector[]>('/admin/inspectors') });

  useChannel('admin', (e) => {
    if (e.event.startsWith('inspection.') || e.event === 'resync') void qc.invalidateQueries({ queryKey: ['dispatch'] });
  });

  const byId = useMemo(() => new Map([...(openAll.data ?? []), ...(requests.data ?? [])].map((r) => [r.id, r])), [openAll.data, requests.data]);
  const assignedTo = (inspectorId: string) => (openAll.data ?? []).filter((r) => r.assignment?.inspectorUserId === inspectorId && ['ASSIGNED', 'EN_ROUTE', 'ON_SITE', 'IN_PROGRESS'].includes(r.status));
  const pick = useCallback((r: InspectionRequestItem) => setDialog({ request: r, mode: 'assign' }), []);
  const showBoard = ['today', 'tomorrow', 'week', 'unplanned'].includes(view);

  return (
    <div>
      <PageHeader title="Disposition" subtitle="Aufträge per Drag & Drop einem Außendienstmitarbeiter zuweisen oder über „Mitarbeiter zuweisen“." />
      <Tabs
        tabs={[
          { id: 'today', label: 'Heute' },
          { id: 'tomorrow', label: 'Morgen' },
          { id: 'week', label: 'Woche' },
          { id: 'calendar', label: 'Kalender' },
          { id: 'map', label: 'Karte' },
          { id: 'unplanned', label: 'Ungeplant', count: (openAll.data ?? []).filter((r) => r.status === 'NEW').length },
          { id: 'done', label: 'Erledigt' },
          { id: 'cancelled', label: 'Storniert' },
        ]}
        value={view}
        onChange={setView}
      />
      <div className="mt-4">
        <QueryState query={requests}>
          {view === 'calendar' && <WeekCalendar requests={requests.data ?? []} weekStart={weekStart} onWeek={setWeekStart} onPick={pick} />}
          {view === 'map' && <RequestMap requests={requests.data ?? []} onPick={pick} />}
          {(view === 'done' || view === 'cancelled') &&
            ((requests.data ?? []).length === 0 ? (
              <EmptyState title="Keine Einträge" />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {requests.data!.map((r) => (
                  <RequestCard key={r.id} r={r} draggable={false} />
                ))}
              </div>
            ))}
          {showBoard && (
            <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_2fr]">
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Aufträge ({requests.data?.length ?? 0})</h2>
                <div className="space-y-3">
                  {(requests.data ?? []).length === 0 && <EmptyState title="Keine Aufträge in dieser Ansicht" />}
                  {requests.data?.map((r) => (
                    <RequestCard
                      key={r.id}
                      r={r}
                      onAssign={() => setDialog({ request: r, mode: 'assign' })}
                      onSchedule={() => setDialog({ request: r, mode: 'schedule' })}
                      onCancel={() => setDialog({ request: r, mode: 'cancel' })}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Außendienst</h2>
                {(inspectors.data ?? []).length === 0 ? (
                  <EmptyState title="Noch keine Außendienstmitarbeiter angelegt">Unter „Mitarbeiter“ anlegen.</EmptyState>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {inspectors.data?.map((i) => (
                      <InspectorColumn
                        key={i.id}
                        inspector={i}
                        requests={assignedTo(i.id)}
                        onDropRequest={(id) => {
                          const r = byId.get(id);
                          if (r) setDialog({ request: r, mode: 'assign', inspectorId: i.id });
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </QueryState>
      </div>
      {dialog && <AssignDialog request={dialog.request} mode={dialog.mode} presetInspectorId={dialog.inspectorId} inspectors={inspectors.data ?? []} onClose={() => setDialog(null)} />}
    </div>
  );
}
