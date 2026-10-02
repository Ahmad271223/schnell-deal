'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AUCTION_OUTCOME_LABELS, AUCTION_STATUS_LABELS, DEAL_STATUS_LABELS, formatDateTimeDe, TAX_TYPE_LABELS, type AuctionOutcome, type AuctionStatus, type DealStatus } from '@sd/shared';
import { api } from '@/lib/api';
import { formatEuro, isoToLocalInput, localInputToIso } from '@/lib/format';
import { realtime, useChannel } from '@/lib/realtime';
import type { VehicleFile } from '@/lib/types';
import { Countdown } from '@/components/countdown';
import { VehicleFileView } from '@/components/vehicle-file';
import { Alert, Button, Card, DescriptionList, ErrorAlert, Field, Input, PageHeader, QueryState, StatusBadge, statusBadge, Table, Td } from '@/components/ui';

interface AdminAuction {
  auction: {
    id: string;
    number: string;
    status: AuctionStatus;
    outcome: AuctionOutcome | null;
    startsAt: string;
    endsAt: string;
    originalEndsAt: string;
    durationMinutes: number;
    startPrice: number;
    reservePrice: number | null;
    reserveVisible: boolean;
    bidIncrement: number;
    buyNowPrice: number | null;
    currentBid: number | null;
    bidCount: number;
    bidderCount: number;
    extensionCount: number;
    antiSnipeMinutes: number;
    taxType: 'REGELBESTEUERT' | 'DIFFERENZBESTEUERT';
    buyerFeePctBp: number;
    buyerFeeFixed: number;
    sellerFeePctBp: number;
    sellerFeeFixed: number;
    cancelledReason: string | null;
    resolution: string | null;
    resolvedAt: string | null;
    endedAt: string | null;
  };
  bids: { id: string; sequence: number; amount: number; kind: string; status: string; serverTime: string; transactionId: string; ip: string | null; companyName: string; userEmail: string; label: number | null }[];
  maxBids: { companyName: string; maxAmount: number; active: boolean; updatedAt: string }[];
  deal: { id: string; dealNumber: string; status: DealStatus } | null;
  vehicle: VehicleFile;
  serverNow: string;
}

export default function AdminAuctionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin-auction', id], queryFn: () => api<AdminAuction>(`/admin/auctions/${id}`), refetchInterval: 15_000 });
  useChannel(`auction:${id}`, () => void qc.invalidateQueries({ queryKey: ['admin-auction', id] }));
  useEffect(() => {
    if (q.data) realtime.syncFromServer(q.data.serverNow);
  }, [q.data]);
  const [reason, setReason] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [relistAt, setRelistAt] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setReason('');
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
          const a = q.data.auction;
          return (
            <div>
              <PageHeader
                back="/admin/auktionen"
                title={`${a.number} · ${q.data.vehicle.make ?? ''} ${q.data.vehicle.model ?? ''}`}
                subtitle={`${q.data.vehicle.internalNumber} · ${q.data.vehicle.seller?.name ?? ''}`}
                actions={a.status === 'ENDED' && a.outcome ? statusBadge(AUCTION_OUTCOME_LABELS, a.outcome) : statusBadge(AUCTION_STATUS_LABELS, a.status)}
              />
              <div className="grid gap-4 xl:grid-cols-[1fr_400px]">
                <div className="space-y-4">
                  <Card>
                    <div className="flex flex-wrap items-end justify-between gap-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">{a.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
                        <p className="tabular text-4xl font-bold">{formatEuro(a.currentBid ?? a.startPrice, { whole: true })}</p>
                        <p className="text-sm text-slate-500">
                          {a.bidCount} Gebote · {a.bidderCount} Bieter · {a.extensionCount} Verlängerung(en)
                        </p>
                      </div>
                      <Countdown endsAt={a.endsAt} startsAt={a.startsAt} status={a.status} size="xl" />
                    </div>
                    <div className="mt-4">
                      <DescriptionList
                        cols={3}
                        items={[
                          ['Start', formatDateTimeDe(a.startsAt)],
                          ['Ende', formatDateTimeDe(a.endsAt)],
                          ['Ursprüngliches Ende', formatDateTimeDe(a.originalEndsAt)],
                          ['Startpreis', formatEuro(a.startPrice)],
                          ['Mindestpreis', a.reservePrice !== null ? `${formatEuro(a.reservePrice)} (${a.reserveVisible ? 'sichtbar' : 'verdeckt'})` : 'keiner'],
                          ['Gebotsschritt', formatEuro(a.bidIncrement)],
                          ['Sofortkauf', a.buyNowPrice !== null ? formatEuro(a.buyNowPrice) : '–'],
                          ['Steuerart', TAX_TYPE_LABELS[a.taxType]],
                          ['Anti-Sniping', a.antiSnipeMinutes ? `${a.antiSnipeMinutes} Min.` : 'aus'],
                          ['Käufergebühr', `${a.buyerFeePctBp / 100} % + ${formatEuro(a.buyerFeeFixed)}`],
                          ['Verkäufergebühr', `${a.sellerFeePctBp / 100} % + ${formatEuro(a.sellerFeeFixed)}`],
                          ['Deal', q.data.deal ? <Link key="d" href={`/admin/verkaeufe/${q.data.deal.id}`} className="text-brand-700 underline">{q.data.deal.dealNumber} ({DEAL_STATUS_LABELS[q.data.deal.status][0]})</Link> : '–'],
                        ]}
                      />
                    </div>
                    {a.cancelledReason && <Alert tone="danger" className="mt-3">Abgebrochen: {a.cancelledReason}</Alert>}
                    {a.resolution && <Alert tone="info" className="mt-3">Entscheidung: {a.resolution}</Alert>}
                  </Card>
                  <Card title="Gebote (intern, mit Identität)" padded={false}>
                    <Table head={['#', 'Betrag', 'Art', 'Status', 'Händler', 'Benutzer', 'Serverzeit', 'IP', 'Transaktion']} className="rounded-none border-0">
                      {q.data.bids.map((b) => (
                        <tr key={b.id}>
                          <Td>{b.sequence}</Td>
                          <Td className="tabular font-medium">{formatEuro(b.amount)}</Td>
                          <Td>{b.kind === 'PROXY' ? 'Bietagent' : b.kind === 'BUY_NOW' ? 'Sofortkauf' : 'Manuell'}</Td>
                          <Td>{b.status === 'WINNING' ? <StatusBadge label="Führend" tone="success" /> : <StatusBadge label="Überboten" tone="neutral" />}</Td>
                          <Td>
                            {b.companyName} <span className="text-xs text-slate-500">(Bieter {b.label})</span>
                          </Td>
                          <Td className="text-xs">{b.userEmail}</Td>
                          <Td className="text-xs">{new Date(b.serverTime).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)}</Td>
                          <Td className="text-xs">{b.ip ?? '–'}</Td>
                          <Td className="font-mono text-[10px]">{b.transactionId.slice(0, 8)}</Td>
                        </tr>
                      ))}
                      {q.data.bids.length === 0 && (
                        <tr>
                          <Td colSpan={9} className="text-slate-500">
                            Noch keine Gebote.
                          </Td>
                        </tr>
                      )}
                    </Table>
                  </Card>
                  {q.data.maxBids.length > 0 && (
                    <Card title="Bietagenten (nur für Administration sichtbar)" padded={false}>
                      <Table head={['Händler', 'Maximalgebot', 'Status', 'Geändert']} className="rounded-none border-0">
                        {q.data.maxBids.map((m, i) => (
                          <tr key={i}>
                            <Td>{m.companyName}</Td>
                            <Td className="tabular">{formatEuro(m.maxAmount)}</Td>
                            <Td>{m.active ? <StatusBadge label="aktiv" tone="success" /> : <StatusBadge label="inaktiv" tone="neutral" />}</Td>
                            <Td>{formatDateTimeDe(m.updatedAt)}</Td>
                          </tr>
                        ))}
                      </Table>
                    </Card>
                  )}
                  <Card>
                    <VehicleFileView file={q.data.vehicle} />
                  </Card>
                </div>
                <div className="space-y-4">
                  <Card title="Aktionen">
                    <div className="space-y-4">
                      {a.status === 'DRAFT' && (
                        <div className="flex flex-wrap gap-2">
                          <Button onClick={() => run('schedule', () => api(`/admin/auctions/${id}/schedule`, { method: 'POST' }))} loading={busy === 'schedule'}>
                            Einplanen
                          </Button>
                          <Button variant="secondary" onClick={() => run('start', () => api(`/admin/auctions/${id}/start-now`, { method: 'POST' }))} loading={busy === 'start'}>
                            Sofort starten
                          </Button>
                        </div>
                      )}
                      {a.status === 'SCHEDULED' && (
                        <div className="flex flex-wrap gap-2">
                          <Button variant="secondary" onClick={() => run('start', () => api(`/admin/auctions/${id}/start-now`, { method: 'POST' }))} loading={busy === 'start'}>
                            Sofort starten
                          </Button>
                          <Button variant="ghost" onClick={() => run('unschedule', () => api(`/admin/auctions/${id}/unschedule`, { method: 'POST' }))} loading={busy === 'unschedule'}>
                            Zurück zu Entwurf
                          </Button>
                        </div>
                      )}
                      {(a.status === 'ACTIVE' || a.status === 'SCHEDULED') && (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <Field label="Endzeit ändern">
                            <Input type="datetime-local" value={endsAt || isoToLocalInput(a.endsAt)} onChange={(e) => setEndsAt(e.target.value)} />
                          </Field>
                          <Field label="Begründung">
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                          </Field>
                          <Button size="sm" variant="secondary" disabled={!endsAt || reason.length < 3} loading={busy === 'end'} onClick={() => run('end', () => api(`/admin/auctions/${id}/end-time`, { method: 'POST', body: { endsAt: localInputToIso(endsAt), reason } }))}>
                            Endzeit übernehmen (live für alle)
                          </Button>
                        </div>
                      )}
                      {(a.status === 'ACTIVE' || a.status === 'SCHEDULED' || a.status === 'DRAFT') && (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <p className="text-sm text-slate-600">Auktion stoppen (nur ohne verbindlichen Zuschlag). Alle Bieter werden informiert.</p>
                          <Field label="Begründung (Pflicht)">
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
                          </Field>
                          <Button size="sm" variant="danger" disabled={reason.length < 3} loading={busy === 'cancel'} onClick={() => confirm('Auktion wirklich stoppen?') && run('cancel', () => api(`/admin/auctions/${id}/cancel`, { method: 'POST', body: { reason } }))}>
                            Auktion stoppen
                          </Button>
                        </div>
                      )}
                      {a.status === 'ENDED' && a.outcome === 'RESERVE_NOT_MET' && !a.resolvedAt && (
                        <div className="space-y-2">
                          <Alert tone="warning" title="Mindestpreis nicht erreicht">
                            Höchstgebot {formatEuro(a.currentBid)} – Mindestpreis {formatEuro(a.reservePrice)}. Keine automatische Verkaufspflicht.
                          </Alert>
                          <Field label="Notiz / Begründung">
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Verkäufer telefonisch einverstanden" />
                          </Field>
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" variant="success" disabled={reason.length < 3} loading={busy === 'accept'} onClick={() => confirm('Zuschlag zum Höchstgebot erteilen? Es wird ein verbindlicher Deal angelegt.') && run('accept', () => api(`/admin/auctions/${id}/accept-highest`, { method: 'POST', body: { note: reason } }))}>
                              Zuschlag zum Höchstgebot
                            </Button>
                            <Button size="sm" variant="secondary" disabled={reason.length < 3} loading={busy === 'contact'} onClick={() => run('contact', () => api(`/admin/auctions/${id}/resolve`, { method: 'POST', body: { resolution: 'SELLER_CONTACTED', note: reason } }))}>
                              Verkäufer kontaktiert
                            </Button>
                            <Button size="sm" variant="danger" disabled={reason.length < 3} loading={busy === 'decline'} onClick={() => run('decline', () => api(`/admin/auctions/${id}/resolve`, { method: 'POST', body: { resolution: 'DECLINED', note: reason } }))}>
                              Ablehnen
                            </Button>
                          </div>
                        </div>
                      )}
                      {(a.status === 'ENDED' || a.status === 'CANCELLED') && !q.data.deal && (
                        <div className="space-y-2 border-t border-slate-200 pt-3">
                          <p className="text-sm font-medium">Erneut einstellen</p>
                          <Field label="Neuer Start">
                            <Input type="datetime-local" value={relistAt} onChange={(e) => setRelistAt(e.target.value)} />
                          </Field>
                          <Button
                            size="sm"
                            disabled={!relistAt}
                            loading={busy === 'relist'}
                            onClick={() =>
                              run('relist', async () => {
                                const r = await api<{ id: string }>(`/admin/auctions/${id}/relist`, { method: 'POST', body: { startsAt: localInputToIso(relistAt) } });
                                window.location.href = `/admin/auktionen/${r.id}`;
                              })
                            }
                          >
                            Als neuen Entwurf anlegen
                          </Button>
                        </div>
                      )}
                      <ErrorAlert error={error} />
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          );
        })()}
    </QueryState>
  );
}
