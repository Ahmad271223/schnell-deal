'use client';

import { useEffect, useState } from 'react';
import { ANTI_SNIPE_OPTIONS, TAX_TYPE_LABELS, TAX_TYPES, type PlatformSettings, type TaxType } from '@sd/shared';
import { useQuery } from '@tanstack/react-query';
import { api, fieldErrors } from '@/lib/api';
import { centsToEuroInput, isoToLocalInput, localInputToIso, parseEuroInput } from '@/lib/format';
import { Alert, Button, Card, Checkbox, ErrorAlert, Field, Input, Select } from './ui';

export interface AuctionFormValues {
  vehicleId: string;
  catalogId: string;
  dealerGroupId: string;
  startsAt: string;
  durationPreset: string;
  durationMinutes: string;
  startPrice: string;
  reservePrice: string;
  reserveVisible: boolean;
  bidIncrement: string;
  buyNowPrice: string;
  taxType: TaxType;
  buyerFeePct: string;
  buyerFeeFixed: string;
  sellerFeePct: string;
  sellerFeeFixed: string;
  locationStreet: string;
  locationZip: string;
  locationCity: string;
  earliestPickup: string;
  antiSnipeMinutes: string;
}

export function emptyAuctionForm(vehicleId = ''): AuctionFormValues {
  const start = new Date(Date.now() + 60 * 60_000);
  start.setMinutes(0, 0, 0);
  return {
    vehicleId,
    catalogId: '',
    dealerGroupId: '',
    startsAt: isoToLocalInput(start.toISOString()),
    durationPreset: '1440',
    durationMinutes: '1440',
    startPrice: '',
    reservePrice: '',
    reserveVisible: false,
    bidIncrement: '100',
    buyNowPrice: '',
    taxType: 'DIFFERENZBESTEUERT',
    buyerFeePct: '',
    buyerFeeFixed: '',
    sellerFeePct: '',
    sellerFeeFixed: '',
    locationStreet: '',
    locationZip: '',
    locationCity: '',
    earliestPickup: '',
    antiSnipeMinutes: '2',
  };
}

export function toAuctionPayload(v: AuctionFormValues) {
  const bp = (s: string) => (s.trim() === '' ? undefined : Math.round(Number(s.replace(',', '.')) * 100));
  return {
    vehicleId: v.vehicleId,
    catalogId: v.catalogId || null,
    dealerGroupId: v.dealerGroupId || null,
    startsAt: localInputToIso(v.startsAt),
    durationMinutes: Number(v.durationPreset === 'custom' ? v.durationMinutes : v.durationPreset),
    startPrice: parseEuroInput(v.startPrice) ?? 0,
    reservePrice: parseEuroInput(v.reservePrice),
    reserveVisible: v.reserveVisible,
    bidIncrement: parseEuroInput(v.bidIncrement) ?? 0,
    buyNowPrice: parseEuroInput(v.buyNowPrice),
    taxType: v.taxType,
    buyerFeePctBp: bp(v.buyerFeePct),
    buyerFeeFixed: parseEuroInput(v.buyerFeeFixed) ?? undefined,
    sellerFeePctBp: bp(v.sellerFeePct),
    sellerFeeFixed: parseEuroInput(v.sellerFeeFixed) ?? undefined,
    locationStreet: v.locationStreet || null,
    locationZip: v.locationZip || null,
    locationCity: v.locationCity || null,
    earliestPickup: v.earliestPickup || null,
    antiSnipeMinutes: Number(v.antiSnipeMinutes),
  };
}

export function AuctionForm({ initial, vehicles, onSubmit, submitLabel, lockVehicle }: { initial: AuctionFormValues; vehicles: { id: string; label: string; zip?: string | null; city?: string | null; street?: string | null }[]; onSubmit: (v: AuctionFormValues, schedule: boolean) => Promise<void>; submitLabel: string; lockVehicle?: boolean }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fe = fieldErrors(error);
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<PlatformSettings>('/admin/settings') });
  const catalogs = useQuery({ queryKey: ['catalogs'], queryFn: () => api<{ id: string; name: string; status: string }[]>('/admin/catalogs') });
  const groups = useQuery({ queryKey: ['dealer-groups'], queryFn: () => api<{ id: string; name: string; memberCount: number }[]>('/admin/dealer-groups') });

  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    setV((o) => ({
      ...o,
      buyerFeePct: o.buyerFeePct || String(s.buyerFeePctBp / 100),
      buyerFeeFixed: o.buyerFeeFixed || centsToEuroInput(s.buyerFeeFixed),
      sellerFeePct: o.sellerFeePct || String(s.sellerFeePctBp / 100),
      sellerFeeFixed: o.sellerFeeFixed || centsToEuroInput(s.sellerFeeFixed),
      antiSnipeMinutes: o.antiSnipeMinutes || String(s.defaultAntiSnipeMinutes),
    }));
  }, [settings.data]);

  useEffect(() => {
    const veh = vehicles.find((x) => x.id === v.vehicleId);
    if (veh && !v.locationZip) setV((o) => ({ ...o, locationStreet: veh.street ?? '', locationZip: veh.zip ?? '', locationCity: veh.city ?? '' }));
  }, [v.vehicleId, vehicles, v.locationZip]);

  const set = (k: keyof AuctionFormValues) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const submit = async (schedule: boolean) => {
    setBusy(schedule ? 'schedule' : 'save');
    setError(null);
    try {
      await onSubmit(v, schedule);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      <Card title="Fahrzeug und Zeitraum">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Fahrzeug" required error={fe.vehicleId} className="lg:col-span-2">
            <Select value={v.vehicleId} onChange={set('vehicleId')} disabled={lockVehicle}>
              <option value="">Bitte wählen (nur freigegebene Fahrzeuge)</option>
              {vehicles.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Katalog">
            <Select value={v.catalogId} onChange={set('catalogId')}>
              <option value="">Ohne Katalog</option>
              {catalogs.data?.filter((c) => c.status !== 'CLOSED').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start" required error={fe.startsAt}>
            <Input type="datetime-local" value={v.startsAt} onChange={set('startsAt')} />
          </Field>
          <Field label="Laufzeit" required error={fe.durationMinutes}>
            <Select value={v.durationPreset} onChange={set('durationPreset')}>
              <option value="720">12 Stunden</option>
              <option value="1440">24 Stunden</option>
              <option value="2880">48 Stunden</option>
              <option value="custom">Individuell</option>
            </Select>
          </Field>
          {v.durationPreset === 'custom' && (
            <Field label="Laufzeit in Minuten" required>
              <Input type="number" min={5} value={v.durationMinutes} onChange={set('durationMinutes')} />
            </Field>
          )}
          <Field label="Händlergruppe" hint="Leer = alle freigegebenen Händler">
            <Select value={v.dealerGroupId} onChange={set('dealerGroupId')}>
              <option value="">Alle Händler</option>
              {groups.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.memberCount})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Verlängerung bei Geboten in der Schlussphase">
            <Select value={v.antiSnipeMinutes} onChange={set('antiSnipeMinutes')}>
              {ANTI_SNIPE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'Aus' : `${m} Minute${m > 1 ? 'n' : ''}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="Preise">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Startpreis (€)" required error={fe.startPrice}>
            <Input inputMode="decimal" value={v.startPrice} onChange={set('startPrice')} />
          </Field>
          <Field label="Mindestpreis / Reserve (€)" error={fe.reservePrice}>
            <Input inputMode="decimal" value={v.reservePrice} onChange={set('reservePrice')} placeholder="ohne" />
          </Field>
          <Field label="Gebotsschritt (€)" required error={fe.bidIncrement}>
            <Input inputMode="decimal" value={v.bidIncrement} onChange={set('bidIncrement')} />
          </Field>
          <Field label="Sofortkaufpreis (€)" error={fe.buyNowPrice}>
            <Input inputMode="decimal" value={v.buyNowPrice} onChange={set('buyNowPrice')} placeholder="ohne" />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox checked={v.reserveVisible} onChange={(b) => setV((o) => ({ ...o, reserveVisible: b }))} label="Mindestpreis für Händler sichtbar" />
          </div>
          <Field label="Steuerart" required className="sm:col-span-2">
            <Select value={v.taxType} onChange={set('taxType')}>
              {TAX_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TAX_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>
      <Card title="Gebühren, Standort, Abholung">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Käufergebühr (%)"><Input inputMode="decimal" value={v.buyerFeePct} onChange={set('buyerFeePct')} /></Field>
          <Field label="Käufergebühr fix (€)"><Input inputMode="decimal" value={v.buyerFeeFixed} onChange={set('buyerFeeFixed')} /></Field>
          <Field label="Verkäufergebühr (%)"><Input inputMode="decimal" value={v.sellerFeePct} onChange={set('sellerFeePct')} /></Field>
          <Field label="Verkäufergebühr fix (€)"><Input inputMode="decimal" value={v.sellerFeeFixed} onChange={set('sellerFeeFixed')} /></Field>
          <Field label="Standort Straße" className="sm:col-span-2"><Input value={v.locationStreet} onChange={set('locationStreet')} /></Field>
          <Field label="PLZ" error={fe.locationZip}><Input value={v.locationZip} onChange={set('locationZip')} /></Field>
          <Field label="Ort"><Input value={v.locationCity} onChange={set('locationCity')} /></Field>
          <Field label="Früheste Abholung"><Input type="date" value={v.earliestPickup} onChange={set('earliestPickup')} /></Field>
        </div>
        <Alert tone="info" className="mt-3">Gebühren gelten netto zzgl. MwSt. Die Werte werden mit der Auktion gespeichert; spätere Änderungen der Standardgebühren wirken sich nicht aus.</Alert>
      </Card>
      <ErrorAlert error={Object.keys(fe).length ? new Error(`Bitte prüfen: ${Object.values(fe).join(' · ')}`) : error} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => submit(true)} loading={busy === 'schedule'} disabled={!v.vehicleId}>
          {submitLabel} und einplanen
        </Button>
        <Button variant="secondary" onClick={() => submit(false)} loading={busy === 'save'} disabled={!v.vehicleId}>
          Als Entwurf speichern
        </Button>
      </div>
    </div>
  );
}
