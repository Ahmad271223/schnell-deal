'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Gavel, Info, UserRoundCog } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTimeDe, TAX_TYPE_LABELS } from '@sd/shared';
import { api, ApiError, newId } from '@/lib/api';
import { centsToEuroInput, formatEuro, parseEuroInput } from '@/lib/format';
import { realtime, useChannel, useServerNow } from '@/lib/realtime';
import type { DealerAuctionState } from '@/lib/types';
import { useMe } from '@/lib/session';
import { Alert, Button, Checkbox, ErrorAlert, Input, Modal } from './ui';

const BINDING_TEXT = 'Mit Abgabe des Gebots geben Sie ein verbindliches Kaufangebot gemäß den geltenden Auktions- und Geschäftsbedingungen ab.';
const TIME_WITH_SECONDS = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const HISTORY_PREVIEW = 5;

interface BidHistoryItem {
  sequence: number;
  amount: number;
  kind: 'MANUAL' | 'PROXY' | 'BUY_NOW';
  serverTime: string;
  label: number | null;
  mine: boolean;
}

type PendingAction = { kind: 'BID'; amount: number } | { kind: 'MAX'; amount: number } | { kind: 'BUY_NOW'; amount: number };

/** Bietpanel nach Vorlage: Countdown, Kennzahlen, Zeitfortschritt, Bieten, Maximalgebot, Gebotsverlauf (anonymisiert). */
export function LiveBidPanel({ auctionId, initial }: { auctionId: string; initial: DealerAuctionState }) {
  const qc = useQueryClient();
  const me = useMe();
  const stateKey = ['auction-state', auctionId];
  const state = useQuery({ queryKey: stateKey, queryFn: () => api<DealerAuctionState>(`/auctions/${auctionId}/state`), initialData: initial, refetchInterval: 30_000 });
  const history = useQuery({ queryKey: ['auction-bids', auctionId], queryFn: () => api<BidHistoryItem[]>(`/auctions/${auctionId}/bids`) });
  const s = state.data;
  const [flash, setFlash] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [dialogAmount, setDialogAmount] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => realtime.syncFromServer(s.serverNow), [s.serverNow]);
  // Bestätigungen verschwinden nach kurzer Zeit wieder (Panel bleibt aufgeräumt wie in der Vorlage).
  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(t);
  }, [result]);

  useChannel(`auction:${auctionId}`, (e) => {
    if (e.event === 'bid') {
      const d = e.data as { currentBid: number; bidCount: number; bidderCount: number; minNextBid: number; endsAt: string; extended: boolean; leaderLabel: number | null; reserveMet?: boolean };
      // Eine Bestätigung wie „Sie führen …“ ist überholt, sobald ein anderer Händler die Führung übernimmt.
      const current = qc.getQueryData<DealerAuctionState>(stateKey);
      if (current && current.me.label !== null && d.leaderLabel !== current.me.label) setResult(null);
      qc.setQueryData<DealerAuctionState>(stateKey, (old) => {
        if (!old) return old;
        const leading = old.me.label !== null && d.leaderLabel === old.me.label;
        return {
          ...old,
          currentBid: d.currentBid,
          bidCount: d.bidCount,
          bidderCount: d.bidderCount,
          minNextBid: d.minNextBid,
          endsAt: d.endsAt,
          leaderLabel: d.leaderLabel,
          reserveMet: d.reserveMet ?? old.reserveMet,
          extensionCount: d.extended ? old.extensionCount + 1 : old.extensionCount,
          me: { ...old.me, status: old.me.label === null ? old.me.status : leading ? 'LEADING' : 'OUTBID' },
        };
      });
      setFlash((f) => f + 1);
      if (d.extended) setNotice(`Auktion verlängert bis ${formatDateTimeDe(d.endsAt)} (Gebot in der Schlussphase).`);
      void qc.invalidateQueries({ queryKey: ['auction-bids', auctionId] });
    } else if (e.event === 'extended') {
      setNotice(`Endzeit geändert: ${formatDateTimeDe((e.data as { endsAt: string }).endsAt)}`);
      void state.refetch();
    } else if (['started', 'ended', 'cancelled', 'resync'].includes(e.event)) {
      void state.refetch();
      void history.refetch();
    }
  });

  const canBid = me.data?.company?.biddingStatus === 'CAN_BID';
  const active = s.status === 'ACTIVE';
  const confirmedKey = `sd-binding-confirmed:${auctionId}`;

  const openDialog = (action: PendingAction) => {
    setConfirmChecked(false);
    setDialogAmount(action.kind === 'BUY_NOW' ? '' : centsToEuroInput(action.amount));
    setPending(action);
  };

  /** Ein Idempotenzschlüssel je Gebotsabsicht; das erste Gebot je Auktion und Sitzung wird ausdrücklich bestätigt. */
  const request = (action: PendingAction) => {
    setError(null);
    setResult(null);
    requestIdRef.current = newId();
    let confirmed: boolean;
    try {
      confirmed = sessionStorage.getItem(confirmedKey) === '1';
    } catch {
      confirmed = false; // z. B. privater Modus ohne Storage
    }
    if (action.kind === 'BID' && confirmed) void send(action);
    else openDialog(action);
  };

  const send = async (action: PendingAction) => {
    setBusy(true);
    setError(null);
    try {
      const clientRequestId = requestIdRef.current ?? newId();
      let res: { status: string; currentBid: number | null; duplicate: boolean };
      if (action.kind === 'BID') {
        res = await api(`/auctions/${auctionId}/bids`, { method: 'POST', body: { amount: action.amount, clientRequestId, confirmBinding: true } });
      } else if (action.kind === 'MAX') {
        res = await api(`/auctions/${auctionId}/max-bid`, { method: 'PUT', body: { maxAmount: action.amount, clientRequestId, confirmBinding: true } });
      } else {
        res = await api(`/auctions/${auctionId}/buy-now`, { method: 'POST', body: { clientRequestId, confirmBinding: true } });
      }
      try {
        sessionStorage.setItem(confirmedKey, '1');
      } catch {
        /* privater Modus */
      }
      setPending(null);
      setResult(
        res.status === 'WON'
          ? 'Sofortkauf erfolgreich – Sie haben den Zuschlag erhalten.'
          : action.kind === 'MAX' && res.status === 'LEADING'
            ? `Maximalgebot gespeichert. Sie führen mit ${formatEuro(res.currentBid)}.`
            : res.status === 'LEADING'
              ? `Gebot angenommen. Sie führen mit ${formatEuro(res.currentBid)}.`
              : `Gebot gespeichert, aber ein Bietagent eines anderen Händlers liegt höher. Aktuelles Gebot: ${formatEuro(res.currentBid)}.`,
      );
      await state.refetch();
      void history.refetch();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.code === 'BIDDER_TERMS_REQUIRED') void qc.invalidateQueries({ queryKey: ['me'] });
      void state.refetch();
      setPending(null);
    } finally {
      setBusy(false);
    }
  };

  const dialogCents = pending && pending.kind !== 'BUY_NOW' ? parseEuroInput(dialogAmount) : (pending?.amount ?? null);
  const dialogTooLow = pending !== null && pending.kind !== 'BUY_NOW' && dialogCents !== null && dialogCents < s.minNextBid;
  const myHighest = s.me.maxBid ?? s.me.highestBid;

  return (
    <div>
      <section className="@container overflow-hidden rounded-[10px] bg-[#0e1a2b] text-white shadow-lg" aria-label="Bieten">
        <div className="flex items-center justify-between gap-3 px-[18px] pt-[22px]">
          <p className="flex items-center gap-2.5 text-[17px] font-bold">
            <span className={clsx('h-3 w-3 rounded-full', active ? 'animate-pulse bg-emerald-500' : s.status === 'SCHEDULED' ? 'bg-sky-400' : 'bg-slate-500')} aria-hidden />
            <span className={active ? 'text-emerald-400' : s.status === 'SCHEDULED' ? 'text-sky-300' : 'text-slate-300'}>
              {active ? 'Live Auktion' : s.status === 'SCHEDULED' ? 'Geplante Auktion' : s.status === 'CANCELLED' ? 'Auktion abgebrochen' : 'Auktion beendet'}
            </span>
          </p>
          <p className="text-[15px] text-slate-100">{active ? 'Auktion endet in' : s.status === 'SCHEDULED' ? 'Beginnt in' : `Ende: ${formatDateTimeDe(s.endsAt)}`}</p>
        </div>

        <CountdownBoxes state={s} />
        {notice && (
          <p className="mx-4 mt-3 flex items-start gap-2 rounded-md bg-sky-500/15 px-3 py-2 text-xs text-sky-100" role="status">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {notice}
          </p>
        )}

        <div className="grid grid-cols-3 px-[18px] pt-5 text-center">
          <div key={flash} className={clsx('rounded-md py-1', flash > 0 && 'flash-dark')}>
            <p className="text-[13px] text-slate-300">{s.currentBid !== null ? 'Aktuelles Gebot' : 'Startpreis'}</p>
            <p className="tabular mt-1 text-[22px] font-bold @sm:text-[26px]" aria-live="polite" data-testid="current-bid">
              {formatEuro(s.currentBid ?? s.startPrice, { whole: true })}
            </p>
          </div>
          <div className="py-1">
            <p className="text-[13px] text-slate-300">Ihr Höchstgebot</p>
            <p className="tabular mt-1.5 text-[19px] font-bold @sm:text-[22px]">{myHighest !== null ? formatEuro(myHighest, { whole: true }) : '–'}</p>
          </div>
          <div className="py-1">
            <p className="text-[13px] text-slate-300">Nächstes Gebot</p>
            <p className="tabular mt-1.5 text-[19px] font-bold @sm:text-[22px]" data-testid="next-bid">{formatEuro(s.minNextBid, { whole: true })}</p>
          </div>
        </div>

        <div className="px-[18px] pt-6">
          <TimeProgress state={s} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 px-[18px] pt-2 text-[12.5px] text-slate-200">
          <span>Mindestgebot: {formatEuro(s.minNextBid, { whole: true })}</span>
          {s.buyNowPrice !== null &&
            (active && canBid ? (
              <button type="button" onClick={() => request({ kind: 'BUY_NOW', amount: s.buyNowPrice! })} data-testid="buy-now-button" className="underline-offset-2 hover:underline">
                Sofortkauf: {formatEuro(s.buyNowPrice, { whole: true })}
              </button>
            ) : (
              <span>Sofortkauf: {formatEuro(s.buyNowPrice, { whole: true })}</span>
            ))}
        </div>

        <div className="space-y-3 px-4 pt-4">
          {s.me.status !== 'NONE' && <StatusLine status={s.me.status} />}
          {active && !canBid && (
            <Alert tone="warning" title="Gebotsabgabe nicht möglich">
              {me.data?.company?.biddingStatus === 'VIEW_ONLY' ? 'Ihr Konto ist derzeit nur zur Ansicht freigeschaltet.' : 'Ihr Bieterkonto ist gesperrt.'}
            </Alert>
          )}
          {active && canBid && (
            <>
              <button
                type="button"
                onClick={() => request({ kind: 'BID', amount: s.minNextBid })}
                disabled={s.me.status === 'LEADING' || busy}
                data-testid="place-bid-button"
                className="flex h-[54px] w-full items-center justify-center gap-3 rounded-md bg-[#e30613] text-[17px] font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-[#e30613]/45"
              >
                <Gavel className="h-6 w-6" aria-hidden />
                {s.me.status === 'LEADING' ? 'Sie sind Höchstbietender' : `Jetzt ${formatEuro(s.minNextBid, { whole: true })} bieten`}
              </button>
              <button
                type="button"
                onClick={() => request({ kind: 'MAX', amount: Math.max(s.minNextBid, (s.me.maxBid ?? 0) + s.bidIncrement) })}
                data-testid="max-bid-button"
                className="flex h-[49px] w-full items-center justify-center gap-3 rounded-md bg-[#e9ecef] text-base font-medium text-slate-900 transition-colors hover:bg-white"
              >
                <UserRoundCog className="h-5 w-5" aria-hidden /> Maximalgebot setzen
              </button>
            </>
          )}
          {result && (
            <p className="flex items-start gap-2 rounded-md bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100" role="status">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {result}
            </p>
          )}
          <ErrorAlert error={error} />
        </div>

        <BidHistory items={history.data ?? []} total={s.bidCount} ownName={me.data?.company?.name ?? null} />
      </section>

      <Modal
        open={pending !== null}
        onClose={() => !busy && setPending(null)}
        title={pending?.kind === 'BUY_NOW' ? 'Sofortkauf bestätigen' : pending?.kind === 'MAX' ? 'Maximalgebot setzen' : 'Verbindliches Gebot bestätigen'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={busy}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              onClick={() => pending && dialogCents && send({ ...pending, amount: dialogCents } as PendingAction)}
              disabled={!confirmChecked || !dialogCents || dialogTooLow}
              loading={busy}
            >
              {pending?.kind === 'BUY_NOW' ? 'Verbindlich kaufen' : 'Verbindlich bieten'}
            </Button>
          </>
        }
      >
        {pending && (
          <div className="space-y-4">
            {pending.kind === 'BUY_NOW' ? (
              <p className="tabular text-2xl font-bold">{formatEuro(pending.amount)}</p>
            ) : (
              <div className="space-y-1">
                <label htmlFor="dialog-amount" className="text-sm font-semibold">
                  {pending.kind === 'MAX' ? 'Maximalgebot (€)' : 'Gebotsbetrag (€)'}
                </label>
                <div className="relative">
                  <Input id="dialog-amount" inputMode="decimal" value={dialogAmount} onChange={(e) => setDialogAmount(e.target.value)} className="h-12 pr-8 text-lg" aria-describedby="dialog-amount-hint" autoFocus />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">€</span>
                </div>
                <p id="dialog-amount-hint" className={clsx('text-xs', dialogTooLow ? 'font-medium text-red-700' : 'text-slate-500')}>
                  Mindestens {formatEuro(s.minNextBid)}
                  {pending.kind === 'MAX'
                    ? '. Das System bietet automatisch nur den jeweils nötigen nächsten Schritt bis zu Ihrem Maximum. Ihr Maximalgebot ist für andere Händler nie sichtbar.'
                    : ` · Gebotsschritt ${formatEuro(s.bidIncrement, { whole: true })}`}
                </p>
                {pending.kind === 'MAX' && s.me.maxBid !== null && (
                  <p className="text-xs text-slate-600">
                    Aktuell hinterlegt: <strong>{formatEuro(s.me.maxBid)}</strong>
                    {s.me.maxBidExhausted && ' (ausgeschöpft)'}
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-slate-600">
              {TAX_TYPE_LABELS[s.taxType]} · zzgl. Käufergebühr {s.buyerFeePctBp ? `${s.buyerFeePctBp / 100} % + ` : ''}
              {formatEuro(s.buyerFeeFixed)} netto
              {s.reserveVisible && s.reservePrice !== undefined && ` · Mindestpreis ${formatEuro(s.reservePrice ?? null, { whole: true })} (${s.reserveMet ? 'erreicht' : 'noch nicht erreicht'})`}
              {s.antiSnipeMinutes > 0 && ` · Verlängerung um ${s.antiSnipeMinutes} Min. bei Geboten in den letzten ${s.antiSnipeMinutes} Min.`}
            </p>
            <Alert tone="warning">{BINDING_TEXT}</Alert>
            <Checkbox checked={confirmChecked} onChange={setConfirmChecked} label="Ich bestätige, dass mein Gebot verbindlich ist." />
          </div>
        )}
      </Modal>
    </div>
  );
}

function StatusLine({ status }: { status: DealerAuctionState['me']['status'] }) {
  const map: Record<DealerAuctionState['me']['status'], { cls: string; icon: typeof Info; text: string }> = {
    LEADING: { cls: 'bg-emerald-600', icon: CheckCircle2, text: 'Sie führen' },
    OUTBID: { cls: 'bg-amber-500', icon: AlertTriangle, text: 'Sie wurden überboten' },
    WON: { cls: 'bg-emerald-700', icon: CheckCircle2, text: 'Zuschlag erhalten' },
    LOST: { cls: 'bg-slate-600', icon: Info, text: 'Nicht gewonnen' },
    RESERVE_NOT_MET: { cls: 'bg-amber-500', icon: AlertTriangle, text: 'Mindestpreis nicht erreicht – Entscheidung ausstehend' },
    NONE: { cls: 'bg-white/10', icon: Info, text: 'Noch kein Gebot von Ihnen' },
  };
  const m = map[status];
  return (
    <div className={clsx('flex items-center gap-2 rounded-md px-3 py-2 text-sm text-white', m.cls)} role="status">
      <m.icon className="h-4 w-4" aria-hidden /> <span className="font-semibold">{m.text}</span>
    </div>
  );
}

/** Restzeit in Kästchen auf Basis der Serverzeit (nie der Browseruhr allein). */
function CountdownBoxes({ state: s }: { state: DealerAuctionState }) {
  const now = useServerNow(250);
  const box = 'mx-4 mt-4 rounded-md border border-white/5 bg-[#0a1422]';
  if (s.status !== 'ACTIVE' && s.status !== 'SCHEDULED') {
    return <div className={clsx(box, 'py-6 text-center text-2xl font-bold')}>{s.status === 'CANCELLED' ? 'Abgebrochen' : 'Beendet'}</div>;
  }
  const target = new Date(s.status === 'SCHEDULED' ? s.startsAt : s.endsAt).getTime();
  const ms = target - now;
  if (ms <= 0 && s.status === 'ACTIVE') {
    return <div className={clsx(box, 'py-6 text-center text-lg font-semibold')}>Endzeit erreicht – wird ausgewertet</div>;
  }
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const parts: [number, string][] = [
    ...(days > 0 ? ([[days, days === 1 ? 'Tag' : 'Tage']] as [number, string][]) : []),
    [Math.floor((total % 86400) / 3600), 'Stunden'],
    [Math.floor((total % 3600) / 60), 'Minuten'],
    [total % 60, 'Sekunden'],
  ];
  const urgent = s.status === 'ACTIVE' && ms < 2 * 60_000;
  return (
    <div className={clsx(box, 'px-3 py-3')} role="timer" aria-live={urgent ? 'polite' : 'off'}>
      <div className="flex items-start justify-center">
        {parts.map(([value, label], i) => (
          <Fragment key={label}>
            {i > 0 && (
              <span className="px-2 text-[32px] font-bold leading-none" aria-hidden>
                :
              </span>
            )}
            <div className="min-w-[4rem] text-center">
              <div className={clsx('tabular text-[32px] font-bold leading-none', urgent && 'text-red-400')}>{String(value).padStart(2, '0')}</div>
              <div className="mt-2 text-[13px] text-slate-200">{label}</div>
            </div>
          </Fragment>
        ))}
      </div>
      {urgent && <span className="sr-only">Auktion endet in Kürze</span>}
    </div>
  );
}

/** Verstrichener Anteil der Auktionslaufzeit. */
function TimeProgress({ state: s }: { state: DealerAuctionState }) {
  const now = useServerNow(1000);
  const start = new Date(s.startsAt).getTime();
  const end = new Date(s.endsAt).getTime();
  const pct = s.status === 'SCHEDULED' ? 0 : s.status === 'ACTIVE' ? Math.min(100, Math.max(0, ((now - start) / Math.max(1, end - start)) * 100)) : 100;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Verstrichene Auktionszeit" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="h-full rounded-full bg-[#e30613] transition-[width] duration-1000" style={{ width: `${pct}%` }} />
    </div>
  );
}

function BidHistory({ items, total, ownName }: { items: BidHistoryItem[]; total: number; ownName: string | null }) {
  const [filter, setFilter] = useState<'all' | 'mine'>('all');
  const [expanded, setExpanded] = useState(false);
  const list = filter === 'mine' ? items.filter((b) => b.mine) : items;
  const shown = expanded ? list : list.slice(0, HISTORY_PREVIEW);
  const top = items.reduce<BidHistoryItem | null>((best, b) => (!best || b.amount > best.amount || (b.amount === best.amount && b.sequence > best.sequence) ? b : best), null);
  return (
    <div className={clsx('px-4 pt-7', list.length > HISTORY_PREVIEW ? 'pb-1' : 'pb-4')}>
      <div className="flex items-center justify-between gap-3 px-0.5">
        <h3 className="text-[17px] font-bold">
          Gebotsverlauf <span className="font-normal">({total})</span>
        </h3>
        <div className="relative">
          <select
            aria-label="Gebote filtern"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as 'all' | 'mine');
              setExpanded(false);
            }}
            className="h-[34px] appearance-none rounded-md border border-white/25 bg-transparent pl-3 pr-9 text-[13px] text-white"
          >
            <option value="all" className="text-slate-900">
              Alle Gebote
            </option>
            <option value="mine" className="text-slate-900">
              Meine Gebote
            </option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden />
        </div>
      </div>
      <div className="mt-3 overflow-hidden rounded-md bg-white text-slate-900">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-100 text-left text-slate-600">
              <th scope="col" className="h-[34px] w-[28%] px-3 font-normal">
                Zeit
              </th>
              <th scope="col" className="px-3 font-normal">
                Händler
              </th>
              <th scope="col" className="w-[40%] px-3 font-normal">
                Gebot
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className="border-t border-slate-200/70">
                <td colSpan={3} className="h-9 px-3 text-slate-500">
                  {filter === 'mine' ? 'Sie haben noch nicht geboten.' : 'Noch keine Gebote.'}
                </td>
              </tr>
            )}
            {shown.map((b) => {
              const isTop = top !== null && b.sequence === top.sequence;
              return (
                <tr key={b.sequence} className={clsx('h-9 border-t border-slate-200/70', isTop ? 'bg-white' : 'bg-slate-50')}>
                  <td className="tabular whitespace-nowrap px-3" title={formatDateTimeDe(b.serverTime)}>
                    {TIME_WITH_SECONDS.format(new Date(b.serverTime))}
                  </td>
                  <td className="px-3">
                    {b.mine ? (
                      <>
                        {ownName ?? 'Sie'} {ownName && <span className="text-slate-500">(Sie)</span>}
                      </>
                    ) : (
                      `Bieter ${b.label ?? '?'}`
                    )}
                    {b.kind === 'PROXY' && <span className="ml-1 text-xs text-slate-500">(Bietagent)</span>}
                    {b.kind === 'BUY_NOW' && <span className="ml-1 text-xs text-emerald-700">(Sofortkauf)</span>}
                  </td>
                  <td className="px-3">
                    <span className="flex items-center justify-between gap-2">
                      <span className="tabular whitespace-nowrap font-bold">{formatEuro(b.amount, { whole: true })}</span>
                      {isTop && <span className="whitespace-nowrap rounded-sm bg-[#e30613] px-1.5 py-0.5 text-[11px] font-medium text-white">Höchstgebot</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {list.length > HISTORY_PREVIEW && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-center gap-2 py-3.5 text-[13px] text-white hover:underline" aria-expanded={expanded}>
          {expanded ? 'Weniger anzeigen' : `Alle ${list.length} Gebote anzeigen`}
          <ChevronRight className={clsx('h-4 w-4 transition-transform', expanded && '-rotate-90')} aria-hidden />
        </button>
      )}
    </div>
  );
}
