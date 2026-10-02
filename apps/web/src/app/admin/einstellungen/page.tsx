'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { formatDateTimeDe, LEGAL_KIND_LABELS, LEGAL_KINDS, type LegalKind, type PlatformSettings } from '@sd/shared';
import { api } from '@/lib/api';
import { centsToEuroInput, parseEuroInput } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Alert, Button, Card, Checkbox, ErrorAlert, Field, Input, Modal, PageHeader, QueryState, Select, StatusBadge, Table, Tabs, Td, Textarea } from '@/components/ui';

type Tab = 'fees' | 'legal' | 'groups' | 'system';

function SettingsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'fees');
  return (
    <div>
      <PageHeader title="Einstellungen" />
      <Tabs tabs={[{ id: 'fees', label: 'Gebühren & Regeln' }, { id: 'legal', label: 'Rechtstexte' }, { id: 'groups', label: 'Händlergruppen' }, { id: 'system', label: 'Systemstatus' }]} value={tab} onChange={setTab} />
      <div className="mt-4">
        {tab === 'fees' && <FeesTab />}
        {tab === 'legal' && <LegalTab />}
        {tab === 'groups' && <GroupsTab />}
        {tab === 'system' && <SystemTab />}
      </div>
    </div>
  );
}

function FeesTab() {
  const me = useMe();
  const q = useQuery({ queryKey: ['admin-settings'], queryFn: () => api<PlatformSettings>('/admin/settings') });
  const [v, setV] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const superadmin = me.data?.user.platformRole === 'SUPERADMIN';
  useEffect(() => {
    const s = q.data;
    if (!s) return;
    setV({
      buyerFeePct: String(s.buyerFeePctBp / 100),
      buyerFeeFixed: centsToEuroInput(s.buyerFeeFixed),
      sellerFeePct: String(s.sellerFeePctBp / 100),
      sellerFeeFixed: centsToEuroInput(s.sellerFeeFixed),
      vatRate: String(s.vatRateBp / 100),
      defaultAntiSnipeMinutes: String(s.defaultAntiSnipeMinutes),
      paymentDueDays: String(s.paymentDueDays),
      paintFlagBelowUm: String(s.paintFlagBelowUm),
      paintFlagAboveUm: String(s.paintFlagAboveUm),
      paymentInstructions: s.paymentInstructions,
      platformName: s.platformName,
      platformAddress: s.platformAddress,
      supportEmail: s.supportEmail,
      supportPhone: s.supportPhone,
      endingSoonMinutes: String(s.endingSoonMinutes),
    });
  }, [q.data]);
  const set = (k: string) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      const bp = (s: string | undefined) => Math.round(Number((s ?? '0').replace(',', '.')) * 100);
      await api('/admin/settings', {
        method: 'PUT',
        body: {
          buyerFeePctBp: bp(v.buyerFeePct),
          buyerFeeFixed: parseEuroInput(v.buyerFeeFixed ?? '0') ?? 0,
          sellerFeePctBp: bp(v.sellerFeePct),
          sellerFeeFixed: parseEuroInput(v.sellerFeeFixed ?? '0') ?? 0,
          vatRateBp: bp(v.vatRate),
          defaultAntiSnipeMinutes: Number(v.defaultAntiSnipeMinutes),
          paymentDueDays: Number(v.paymentDueDays),
          paintFlagBelowUm: Number(v.paintFlagBelowUm),
          paintFlagAboveUm: Number(v.paintFlagAboveUm),
          paymentInstructions: v.paymentInstructions,
          platformName: v.platformName,
          platformAddress: v.platformAddress,
          supportEmail: (v.supportEmail ?? '').trim(),
          supportPhone: (v.supportPhone ?? '').trim(),
          endingSoonMinutes: Number(v.endingSoonMinutes),
        },
      });
      setSaved(true);
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <QueryState query={q}>
      <Card title="Standardwerte">
        {!superadmin && <Alert tone="info" className="mb-3">Nur Superadmins können Einstellungen ändern.</Alert>}
        <fieldset disabled={!superadmin} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Käufergebühr (%)"><Input value={v.buyerFeePct ?? ''} onChange={set('buyerFeePct')} /></Field>
          <Field label="Käufergebühr fix (€)"><Input value={v.buyerFeeFixed ?? ''} onChange={set('buyerFeeFixed')} /></Field>
          <Field label="Verkäufergebühr (%)"><Input value={v.sellerFeePct ?? ''} onChange={set('sellerFeePct')} /></Field>
          <Field label="Verkäufergebühr fix (€)"><Input value={v.sellerFeeFixed ?? ''} onChange={set('sellerFeeFixed')} /></Field>
          <Field label="MwSt.-Satz (%)"><Input value={v.vatRate ?? ''} onChange={set('vatRate')} /></Field>
          <Field label="Zahlungsfrist (Tage)"><Input value={v.paymentDueDays ?? ''} onChange={set('paymentDueDays')} /></Field>
          <Field label="Standard Anti-Sniping (Min.)">
            <Select value={v.defaultAntiSnipeMinutes ?? '2'} onChange={set('defaultAntiSnipeMinutes')}>
              {[0, 1, 2, 3, 5].map((m) => <option key={m} value={m}>{m === 0 ? 'aus' : m}</option>)}
            </Select>
          </Field>
          <Field label="„Endet bald“-Hinweis (Min.)"><Input value={v.endingSoonMinutes ?? ''} onChange={set('endingSoonMinutes')} /></Field>
          <Field label="Lackwert auffällig unter (µm)"><Input value={v.paintFlagBelowUm ?? ''} onChange={set('paintFlagBelowUm')} /></Field>
          <Field label="Lackwert auffällig über (µm)"><Input value={v.paintFlagAboveUm ?? ''} onChange={set('paintFlagAboveUm')} /></Field>
          <Field label="Plattformname" className="sm:col-span-2"><Input value={v.platformName ?? ''} onChange={set('platformName')} /></Field>
          <Field label="Anschrift Plattformbetreiber (PDF-Kopf)" className="sm:col-span-2 lg:col-span-4"><Input value={v.platformAddress ?? ''} onChange={set('platformAddress')} /></Field>
          <Field label="Support-E-Mail (Kontakt auf der Auktionsseite)" hint="Leer lassen, um keinen Kontakt anzuzeigen." className="sm:col-span-2"><Input type="email" value={v.supportEmail ?? ''} onChange={set('supportEmail')} /></Field>
          <Field label="Support-Telefon" className="sm:col-span-2"><Input type="tel" value={v.supportPhone ?? ''} onChange={set('supportPhone')} /></Field>
          <Field label="Zahlungsinformationen (Käufer-PDF)" className="sm:col-span-2 lg:col-span-4"><Textarea value={v.paymentInstructions ?? ''} onChange={set('paymentInstructions')} rows={3} /></Field>
        </fieldset>
        {superadmin && (
          <div className="mt-4 flex items-center gap-3">
            <Button onClick={save}>Speichern</Button>
            {saved && <span className="text-sm text-emerald-700">Gespeichert und protokolliert.</span>}
          </div>
        )}
        <ErrorAlert error={error} className="mt-3" />
      </Card>
    </QueryState>
  );
}

interface LegalDoc {
  id: string;
  kind: LegalKind;
  version: string;
  title: string;
  content: string;
  activeFrom: string;
  createdAt: string;
}

function LegalTab() {
  const q = useQuery({ queryKey: ['admin-legal'], queryFn: () => api<LegalDoc[]>('/admin/legal') });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'TERMS' as LegalKind, version: '', title: '', content: '' });
  const [view, setView] = useState<LegalDoc | null>(null);
  const [error, setError] = useState<unknown>(null);
  const publish = async () => {
    setError(null);
    try {
      await api('/admin/legal', { method: 'POST', body: f });
      setOpen(false);
      void q.refetch();
    } catch (e) {
      setError(e);
    }
  };
  const now = Date.now();
  const activeIds = new Set(LEGAL_KINDS.map((k) => (q.data ?? []).filter((d) => d.kind === k && new Date(d.activeFrom).getTime() <= now).sort((a, b) => b.activeFrom.localeCompare(a.activeFrom))[0]?.id));
  return (
    <div className="space-y-3">
      <Alert tone="warning" title="Rechtstexte werden nicht von der Plattform formuliert">
        Hinterlegen Sie hier ausschließlich juristisch geprüfte Fassungen. Jede neue Version muss von allen Benutzern erneut akzeptiert werden; Zustimmungen werden mit Zeitpunkt gespeichert. Veröffentlichte Versionen sind unveränderlich.
      </Alert>
      <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>
        Neue Version veröffentlichen
      </Button>
      <QueryState query={q}>
        <Table head={['Art', 'Version', 'Titel', 'Gültig ab', 'Status', '']}>
          {q.data?.map((d) => (
            <tr key={d.id}>
              <Td>{LEGAL_KIND_LABELS[d.kind]}</Td>
              <Td className="font-mono">{d.version}</Td>
              <Td>{d.title}</Td>
              <Td>{formatDateTimeDe(d.activeFrom)}</Td>
              <Td>{activeIds.has(d.id) ? <StatusBadge label="Aktuell gültig" tone="success" /> : new Date(d.activeFrom).getTime() > now ? <StatusBadge label="Geplant" tone="info" /> : <StatusBadge label="Abgelöst" tone="neutral" />}</Td>
              <Td>
                <Button size="sm" variant="ghost" onClick={() => setView(d)}>
                  Anzeigen
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={open} onClose={() => setOpen(false)} title="Neue Rechtstext-Version" size="lg" footer={<Button onClick={publish} disabled={!f.version || !f.title || !f.content}>Veröffentlichen</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Art">
            <Select value={f.kind} onChange={(e) => setF((o) => ({ ...o, kind: e.target.value as LegalKind }))}>
              {LEGAL_KINDS.map((k) => <option key={k} value={k}>{LEGAL_KIND_LABELS[k]}</option>)}
            </Select>
          </Field>
          <Field label="Version"><Input value={f.version} onChange={(e) => setF((o) => ({ ...o, version: e.target.value }))} placeholder="z. B. 1.0" /></Field>
          <Field label="Titel" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF((o) => ({ ...o, title: e.target.value }))} /></Field>
          <Field label="Text" className="sm:col-span-2"><Textarea value={f.content} onChange={(e) => setF((o) => ({ ...o, content: e.target.value }))} rows={14} /></Field>
        </div>
        <ErrorAlert error={error} className="mt-3" />
      </Modal>
      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.title} (${view.version})` : ''} size="lg">
        <div className="whitespace-pre-wrap text-sm">{view?.content}</div>
      </Modal>
    </div>
  );
}

interface Group {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  members: string[];
}

function GroupsTab() {
  const groups = useQuery({ queryKey: ['dealer-groups'], queryFn: () => api<Group[]>('/admin/dealer-groups') });
  const dealers = useQuery({ queryKey: ['admin-companies', 'DEALER', 'APPROVED', ''], queryFn: () => api<{ id: string; name: string; city: string }[]>('/admin/companies?type=DEALER&status=APPROVED') });
  const [edit, setEdit] = useState<Group | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const create = async () => {
    setError(null);
    try {
      await api('/admin/dealer-groups', { method: 'POST', body: { name, description: null } });
      setName('');
      void groups.refetch();
    } catch (e) {
      setError(e);
    }
  };
  const saveMembers = async () => {
    if (!edit) return;
    setError(null);
    try {
      await api(`/admin/dealer-groups/${edit.id}/members`, { method: 'PUT', body: { companyIds: members } });
      setEdit(null);
      void groups.refetch();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">Händlergruppen steuern, welche Händler eine Auktion sehen und bieten dürfen.</p>
      <div className="flex gap-2">
        <Input placeholder="Neue Gruppe, z. B. Region Nord" value={name} onChange={(e) => setName(e.target.value)} className="w-72" />
        <Button onClick={create} disabled={name.trim().length < 2}>
          Anlegen
        </Button>
      </div>
      <ErrorAlert error={error} />
      <QueryState query={groups}>
        <Table head={['Gruppe', 'Mitglieder', '']}>
          {groups.data?.map((g) => (
            <tr key={g.id}>
              <Td>{g.name}</Td>
              <Td>{g.memberCount}</Td>
              <Td>
                <Button size="sm" variant="secondary" onClick={() => (setEdit(g), setMembers(g.members))}>
                  Mitglieder bearbeiten
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      </QueryState>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Mitglieder: ${edit?.name ?? ''}`} footer={<Button onClick={saveMembers}>Speichern</Button>}>
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {(dealers.data ?? []).map((d) => (
            <Checkbox key={d.id} checked={members.includes(d.id)} onChange={(v) => setMembers((m) => (v ? [...m, d.id] : m.filter((x) => x !== d.id)))} label={`${d.name} (${d.city})`} />
          ))}
          {(dealers.data ?? []).length === 0 && <p className="text-sm text-slate-500">Keine freigegebenen Händler.</p>}
        </div>
      </Modal>
    </div>
  );
}

interface SystemStatus {
  jobs: { type: string; status: string; n: number }[];
  failedJobs: { id: number; type: string; attempts: number; lastError: string | null; createdAt: string; payload: unknown }[];
  overduePending: number;
  malwareScan: 'clamav' | 'disabled';
  scheduler: { enabled: boolean; lastTickAt: string | null; lastError: string | null; tickRunningSince: string | null };
  serverTime: string;
}

function SystemTab() {
  const q = useQuery({ queryKey: ['admin-system'], queryFn: () => api<SystemStatus>('/admin/system'), refetchInterval: 15_000 });
  const health = useQuery({ queryKey: ['health'], queryFn: () => api<{ status: string; db: boolean; storage: boolean; websocketConnections: number }>('/health') });
  const retry = async (id: number) => {
    await api(`/admin/system/jobs/${id}/retry`, { method: 'POST' });
    void q.refetch();
  };
  return (
    <QueryState query={q}>
      {q.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Card>
              <p className="text-xs uppercase text-slate-500">Datenbank</p>
              {health.data?.db ? <StatusBadge label="erreichbar" tone="success" /> : <StatusBadge label="Fehler" tone="danger" />}
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Objektspeicher</p>
              {health.data?.storage ? <StatusBadge label="erreichbar" tone="success" /> : <StatusBadge label="Fehler" tone="danger" />}
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Live-Verbindungen (diese Instanz)</p>
              <p className="tabular text-xl font-semibold">{health.data?.websocketConnections ?? '–'}</p>
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Virenscan Uploads</p>
              {q.data.malwareScan === 'clamav' ? <StatusBadge label="ClamAV aktiv" tone="success" /> : <StatusBadge label="nicht konfiguriert" tone="warning" />}
            </Card>
            <Card>
              <p className="text-xs uppercase text-slate-500">Auktionstakt (diese Instanz)</p>
              {!q.data.scheduler.enabled ? (
                <StatusBadge label="deaktiviert" tone="neutral" />
              ) : q.data.scheduler.lastTickAt && Date.parse(q.data.serverTime) - Date.parse(q.data.scheduler.lastTickAt) < 60_000 ? (
                <StatusBadge label={`aktiv · letzter Takt ${formatDateTimeDe(q.data.scheduler.lastTickAt)}`} tone="success" />
              ) : (
                <StatusBadge label={q.data.scheduler.lastTickAt ? `kein Takt seit ${formatDateTimeDe(q.data.scheduler.lastTickAt)}` : 'noch kein Takt'} tone="danger" />
              )}
              {q.data.scheduler.lastError && <p className="mt-1 text-xs text-red-700">Letzter Fehler: {q.data.scheduler.lastError}</p>}
            </Card>
          </div>
          {q.data.scheduler.enabled && q.data.scheduler.tickRunningSince && Date.parse(q.data.serverTime) - Date.parse(q.data.scheduler.tickRunningSince) > 30_000 && (
            <Alert tone="danger">Der Auktionstakt läuft seit {formatDateTimeDe(q.data.scheduler.tickRunningSince)} ohne Abschluss. Auktionen werden derzeit nicht gestartet oder beendet – Datenbankverbindung prüfen.</Alert>
          )}
          {q.data.overduePending > 0 && <Alert tone="warning">{q.data.overduePending} Job(s) warten seit über 2 Minuten – läuft der Worker?</Alert>}
          <Card title="Hintergrundjobs" padded={false}>
            <Table head={['Typ', 'Status', 'Anzahl']} className="rounded-none border-0">
              {q.data.jobs.map((j) => (
                <tr key={`${j.type}-${j.status}`}>
                  <Td className="font-mono text-xs">{j.type}</Td>
                  <Td>{j.status === 'FAILED' ? <StatusBadge label="Fehlgeschlagen" tone="danger" /> : j.status === 'DONE' ? <StatusBadge label="Erledigt" tone="success" /> : <StatusBadge label={j.status === 'RUNNING' ? 'Läuft' : 'Wartet'} tone="progress" />}</Td>
                  <Td>{j.n}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <Card title="Fehlgeschlagene Jobs" padded={false}>
            {q.data.failedJobs.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">Keine.</p>
            ) : (
              <Table head={['#', 'Typ', 'Versuche', 'Fehler', 'Erstellt', '']} className="rounded-none border-0">
                {q.data.failedJobs.map((j) => (
                  <tr key={j.id}>
                    <Td>{j.id}</Td>
                    <Td className="font-mono text-xs">{j.type}</Td>
                    <Td>{j.attempts}</Td>
                    <Td className="max-w-md whitespace-normal text-xs text-red-700">{j.lastError}</Td>
                    <Td className="text-xs">{formatDateTimeDe(j.createdAt)}</Td>
                    <Td>
                      <Button size="sm" variant="secondary" icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => retry(j.id)}>
                        Erneut ausführen
                      </Button>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}
    </QueryState>
  );
}

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
