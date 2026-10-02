'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, fieldErrors } from '@/lib/api';
import { berlinDate } from '@/lib/format';
import { Alert, Button, Card, ErrorAlert, Field, Input, LinkButton, PageHeader, Textarea, YesNo } from '@/components/ui';

interface Company {
  street: string;
  houseNumber: string;
  zip: string;
  city: string;
  contactFirstName: string;
  contactLastName: string;
  contactPhone: string;
}

export default function ReportTradeInsPage() {
  const qc = useQueryClient();
  const company = useQuery({ queryKey: ['company'], queryFn: () => api<Company>('/company') });
  const [v, setV] = useState({
    vehicleCount: '1',
    locationStreet: '',
    locationZip: '',
    locationCity: '',
    requestedDate: berlinDate(1),
    earliestTime: '09:00',
    latestTime: '16:00',
    contactName: '',
    contactPhone: '',
    notes: '',
  });
  const [drivable, setDrivable] = useState<boolean | null>(true);
  const [keys, setKeys] = useState<boolean | null>(true);
  const [papers, setPapers] = useState<boolean | null>(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ number: string; statusText: string } | null>(null);
  const fe = fieldErrors(error);

  useEffect(() => {
    const c = company.data;
    if (!c) return;
    setV((s) => ({
      ...s,
      locationStreet: s.locationStreet || `${c.street} ${c.houseNumber}`,
      locationZip: s.locationZip || c.zip,
      locationCity: s.locationCity || c.city,
      contactName: s.contactName || `${c.contactFirstName} ${c.contactLastName}`,
      contactPhone: s.contactPhone || c.contactPhone,
    }));
  }, [company.data]);

  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ number: string; statusText: string }>('/inspection-requests', {
        method: 'POST',
        body: {
          ...v,
          vehicleCount: Number(v.vehicleCount),
          notes: v.notes || null,
          vehiclesDrivable: drivable ?? false,
          keysAvailable: keys ?? false,
          papersAvailable: papers ?? false,
        },
      });
      setDone(res);
      void qc.invalidateQueries({ queryKey: ['inspection-requests'] });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden />
            <h1 className="text-xl font-semibold">Anfrage {done.number} eingegangen</h1>
            <p className="text-slate-700">{done.statusText}</p>
            <p className="text-sm text-slate-500">Sie werden benachrichtigt, sobald der Termin und der Außendienstmitarbeiter feststehen.</p>
            <div className="mt-2 flex gap-2">
              <LinkButton href="/autohaus/termine">Zu den Terminen</LinkButton>
              <Button variant="secondary" onClick={() => setDone(null)}>
                Weitere Anfrage
              </Button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Inzahlungnahmen melden" subtitle="Wir planen einen Außendienstmitarbeiter ein, der alle Fahrzeuge vor Ort standardisiert aufnimmt." />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card title="Fahrzeuge und Termin">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Anzahl Fahrzeuge" required error={fe.vehicleCount}>
              <Input type="number" min={1} max={100} value={v.vehicleCount} onChange={set('vehicleCount')} invalid={!!fe.vehicleCount} />
            </Field>
            <Field label="Wunschdatum" required error={fe.requestedDate}>
              <Input type="date" min={berlinDate(0)} value={v.requestedDate} onChange={set('requestedDate')} invalid={!!fe.requestedDate} />
            </Field>
            <Field label="Früheste Uhrzeit" required error={fe.earliestTime}>
              <Input type="time" value={v.earliestTime} onChange={set('earliestTime')} />
            </Field>
            <Field label="Späteste Uhrzeit" required error={fe.latestTime}>
              <Input type="time" value={v.latestTime} onChange={set('latestTime')} invalid={!!fe.latestTime} />
            </Field>
          </div>
        </Card>
        <Card title="Standort und Ansprechpartner vor Ort">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Straße und Hausnummer" required error={fe.locationStreet} className="sm:col-span-2">
              <Input value={v.locationStreet} onChange={set('locationStreet')} invalid={!!fe.locationStreet} />
            </Field>
            <Field label="PLZ" required error={fe.locationZip}>
              <Input inputMode="numeric" value={v.locationZip} onChange={set('locationZip')} invalid={!!fe.locationZip} />
            </Field>
            <Field label="Ort" required error={fe.locationCity}>
              <Input value={v.locationCity} onChange={set('locationCity')} invalid={!!fe.locationCity} />
            </Field>
            <Field label="Ansprechpartner vor Ort" required error={fe.contactName}>
              <Input value={v.contactName} onChange={set('contactName')} invalid={!!fe.contactName} />
            </Field>
            <Field label="Telefonnummer" required error={fe.contactPhone}>
              <Input type="tel" value={v.contactPhone} onChange={set('contactPhone')} invalid={!!fe.contactPhone} />
            </Field>
          </div>
        </Card>
        <Card title="Zustand der Fahrzeuge">
          <div className="flex flex-wrap gap-6">
            <YesNo label="Fahrzeuge stehen fahrbereit" value={drivable} onChange={setDrivable} />
            <YesNo label="Fahrzeugschlüssel vorhanden" value={keys} onChange={setKeys} />
            <YesNo label="Fahrzeugpapiere vorhanden" value={papers} onChange={setPapers} />
          </div>
          <Field label="Notizen (optional)" className="mt-4">
            <Textarea value={v.notes} onChange={set('notes')} placeholder="z. B. Fahrzeuge stehen auf dem hinteren Hof, Zufahrt über Tor 2" />
          </Field>
        </Card>
        <ErrorAlert error={Object.keys(fe).length ? new Error('Bitte die markierten Felder prüfen.') : error} />
        {!papers && <Alert tone="info">Ohne Fahrzeugpapiere kann die Aufnahme erfolgen, die Zulassungsbescheinigung muss jedoch vor Auktionsstart nachgereicht werden.</Alert>}
        <Button type="submit" size="xl" className="w-full" loading={busy}>
          Anfrage absenden
        </Button>
      </form>
    </div>
  );
}
