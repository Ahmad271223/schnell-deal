'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  EMISSION_CLASS_LABELS,
  EMISSION_CLASSES,
  FUEL_LABELS,
  FUEL_TYPES,
  HOLDER_TYPE_LABELS,
  HOLDER_TYPES,
  PHOTO_SLOT_LABELS,
  PHOTO_SLOTS,
  TRANSMISSION_LABELS,
  TRANSMISSIONS,
  VEHICLE_DOCUMENT_KIND_LABELS,
  formatDateTimeDe,
  type PhotoSlot,
} from '@sd/shared';
import { api } from '@/lib/api';
import type { VehicleFile } from '@/lib/types';
import { Alert, Button, Card, Checkbox, ErrorAlert, Field, Input, Select, StatusBadge, Table, Td, Textarea } from './ui';

/** Admin-Aktionen zur Fahrzeugakte: Dokumentfreigabe, Korrektur (mit Revision), interne Kommentare. */
export function AdminVehicleActions({ file }: { file: VehicleFile }) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['vehicle', file.id] });
  return (
    <div className="space-y-4">
      {(file.status === 'APPROVED' || file.status === 'UNSOLD') && (
        <Alert tone="success" title="Bereit für die Auktion">
          <Link href={`/admin/auktionen/neu?vehicleId=${file.id}`} className="font-medium underline">
            Auktion anlegen
          </Link>
        </Alert>
      )}
      <DocumentRelease file={file} onChange={refresh} />
      <Correction file={file} onChange={refresh} />
      <Comments file={file} onChange={refresh} />
      {file.status === 'UNSOLD' && <ReturnToSeller file={file} onChange={refresh} />}
      {file.revisions && file.revisions.length > 0 && (
        <Card title="Korrekturhistorie (Originalwerte bleiben erhalten)" padded={false}>
          <Table head={['Zeitpunkt', 'Feld', 'Vorher', 'Nachher', 'Begründung']} className="rounded-none border-0">
            {file.revisions.map((r) => (
              <tr key={r.id}>
                <Td>{formatDateTimeDe(r.createdAt)}</Td>
                <Td>{r.field}</Td>
                <Td className="font-mono text-xs">{JSON.stringify(r.oldValue)}</Td>
                <Td className="font-mono text-xs">{JSON.stringify(r.newValue)}</Td>
                <Td className="whitespace-normal">{r.reason}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}

function DocumentRelease({ file, onChange }: { file: VehicleFile; onChange: () => void }) {
  const [error, setError] = useState<unknown>(null);
  if (file.documents.length === 0) return null;
  const toggle = async (docId: string, visible: boolean) => {
    setError(null);
    try {
      await api(`/admin/vehicles/${file.id}/documents/${docId}/release`, { method: 'POST', body: { visible } });
      onChange();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Card title="Dokumentfreigabe für Käufer">
      <ul className="space-y-2">
        {file.documents.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-2">
            <span className="text-sm">{VEHICLE_DOCUMENT_KIND_LABELS[d.kind]}</span>
            <Checkbox checked={!!d.visibleToBuyers} onChange={(v) => void toggle(d.id, v)} label={d.visibleToBuyers ? 'freigegeben' : 'nur intern'} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Zulassungsbescheinigungen enthalten personenbezogene Daten. Nur freigeben, wenn erforderlich.</p>
      <ErrorAlert error={error} className="mt-2" />
    </Card>
  );
}

function Correction({ file, onChange }: { file: VehicleFile; onChange: () => void }) {
  const editable = !['IN_AUCTION', 'SOLD', 'COMPLETED'].includes(file.status) && !!file.lockedAt;
  const [field, setField] = useState('mileageKm');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (!editable) return null;
  const fields: Record<string, { label: string; type: 'number' | 'text' | 'date' | 'month' } | { label: string; type: 'select'; options: [string, string][] }> = {
    mileageKm: { label: 'Kilometerstand', type: 'number' },
    make: { label: 'Hersteller', type: 'text' },
    model: { label: 'Modell', type: 'text' },
    variant: { label: 'Variante', type: 'text' },
    firstRegistration: { label: 'Erstzulassung', type: 'date' },
    powerKw: { label: 'Leistung (kW)', type: 'number' },
    fuel: { label: 'Kraftstoff', type: 'select', options: FUEL_TYPES.map((f) => [f, FUEL_LABELS[f]]) },
    transmission: { label: 'Getriebe', type: 'select', options: TRANSMISSIONS.map((t) => [t, TRANSMISSION_LABELS[t]]) },
    color: { label: 'Farbe', type: 'text' },
    ownersCount: { label: 'Anzahl Halter', type: 'number' },
    holderType: { label: 'Fahrzeughalter', type: 'select', options: HOLDER_TYPES.map((h) => [h, HOLDER_TYPE_LABELS[h]]) },
    emissionClass: { label: 'Schadstoffklasse', type: 'select', options: EMISSION_CLASSES.map((c) => [c, EMISSION_CLASS_LABELS[c]]) },
    huUntil: { label: 'HU bis', type: 'month' },
    keysCount: { label: 'Anzahl Schlüssel', type: 'number' },
    licensePlate: { label: 'Kennzeichen', type: 'text' },
  };
  const def = fields[field]!;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const v = def.type === 'number' ? Number(value) : value || null;
      await api(`/admin/vehicles/${file.id}/correct`, { method: 'POST', body: { reason, changes: { [field]: v } } });
      setValue('');
      setReason('');
      onChange();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Korrektur erfassen">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Feld">
          <Select value={field} onChange={(e) => (setField(e.target.value), setValue(''))}>
            {Object.entries(fields).map(([k, f]) => (
              <option key={k} value={k}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Neuer Wert">
          {def.type === 'select' ? (
            <Select value={value} onChange={(e) => setValue(e.target.value)}>
              <option value="">Bitte wählen</option>
              {def.options.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          ) : (
            <Input type={def.type === 'number' ? 'number' : def.type === 'date' ? 'date' : def.type === 'month' ? 'month' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} />
          )}
        </Field>
        <Field label="Begründung" required className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="z. B. Tippfehler laut Tachofoto" />
        </Field>
      </div>
      <Button className="mt-3" onClick={submit} loading={busy} disabled={!value || reason.length < 3}>
        Korrektur speichern
      </Button>
      <ErrorAlert error={error} className="mt-2" />
    </Card>
  );
}

function Comments({ file, onChange }: { file: VehicleFile; onChange: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await api(`/admin/vehicles/${file.id}/comments`, { method: 'POST', body: { text } });
      setText('');
      onChange();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Interne Kommentare (nur Administration)">
      <ul className="mb-3 space-y-2">
        {(file.comments ?? []).map((c) => (
          <li key={c.id} className="rounded bg-slate-50 p-2 text-sm">
            <p>{c.text}</p>
            <p className="mt-1 text-xs text-slate-500">
              {c.author} · {formatDateTimeDe(c.createdAt)}
            </p>
          </li>
        ))}
        {(file.comments ?? []).length === 0 && <li className="text-sm text-slate-500">Keine Kommentare.</li>}
      </ul>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Interner Hinweis" />
      <Button size="sm" className="mt-2" onClick={add} disabled={!text.trim()} loading={busy}>
        Kommentar hinzufügen
      </Button>
    </Card>
  );
}

function ReturnToSeller({ file, onChange }: { file: VehicleFile; onChange: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    try {
      await api(`/admin/vehicles/${file.id}/return-to-seller`, { method: 'POST', body: { reason } });
      onChange();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Card title="Rückgabe an das Autohaus">
      <p className="mb-2 text-sm text-slate-600">Fahrzeug wird nicht erneut eingestellt. Die Akte bleibt dauerhaft erhalten.</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Grund" />
      <Button size="sm" variant="secondary" className="mt-2" onClick={submit} disabled={reason.length < 3}>
        Als zurückgegeben abschließen
      </Button>
      <ErrorAlert error={error} className="mt-2" />
    </Card>
  );
}

/** Prüfentscheidung: Freigeben / Zurück an Mitarbeiter (mit Zusatzfoto-Anforderung). */
export function ReviewPanel({ file, onDone }: { file: VehicleFile; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [slots, setSlots] = useState<PhotoSlot[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const c = file.completeness;
  const submit = async (action: 'approve' | 'return') => {
    setBusy(action);
    setError(null);
    try {
      await api(`/admin/vehicles/${file.id}/review`, { method: 'POST', body: { action, reason: reason || null, requestedPhotoSlots: action === 'return' ? slots : undefined } });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const badPhotos = file.photos.filter((p) => !p.replaced && p.quality !== 'OK');
  return (
    <Card title="Prüfentscheidung">
      {c && (
        <div className="mb-3 space-y-2 text-sm">
          <p>
            Vollständigkeit: <strong>{c.percent} %</strong> · Pflichtfotos {c.photoStats.present}/{c.photoStats.required}
          </p>
          {c.missing.length > 0 && <Alert tone={c.canComplete ? 'info' : 'danger'}>Fehlend: {c.missing.join(', ')}</Alert>}
        </div>
      )}
      {badPhotos.length > 0 && (
        <Alert tone="warning" className="mb-3" title="Fotos mit Qualitätswarnung">
          {badPhotos.map((p) => `${PHOTO_SLOT_LABELS[p.slot]}${p.qualityOverride ? ' (vom Mitarbeiter übersteuert)' : ''}`).join(', ')}
        </Alert>
      )}
      <Field label="Hinweis / Begründung" hint="Bei Rückgabe Pflicht">
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
      </Field>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">Zusatzfotos anfordern ({slots.length})</summary>
        <div className="mt-2 grid max-h-60 grid-cols-2 gap-1 overflow-y-auto">
          {PHOTO_SLOTS.filter((s) => s !== 'DAMAGE').map((s) => (
            <Checkbox key={s} checked={slots.includes(s)} onChange={(v) => setSlots((o) => (v ? [...o, s] : o.filter((x) => x !== s)))} label={PHOTO_SLOT_LABELS[s]} />
          ))}
        </div>
      </details>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="success" onClick={() => submit('approve')} loading={busy === 'approve'} disabled={!c?.canComplete}>
          Freigeben
        </Button>
        <Button variant="danger" onClick={() => submit('return')} loading={busy === 'return'} disabled={reason.trim().length < 3}>
          Zurück an Mitarbeiter
        </Button>
      </div>
      <ErrorAlert error={error} className="mt-3" />
      {file.returnCount ? <StatusBadge label={`${file.returnCount}× zurückgegeben`} tone="warning" className="mt-3" /> : null}
    </Card>
  );
}
