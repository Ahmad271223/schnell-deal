'use client';

import clsx from 'clsx';
import {
  Archive,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  Camera,
  Car,
  CircleCheck,
  ClipboardList,
  CloudUpload,
  FileText,
  Gavel,
  Handshake,
  Heart,
  History,
  House,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Map as MapIcon,
  Menu,
  MessageSquare,
  Package,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Store,
  Timer,
  Truck,
  UserRound,
  Users,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTimeDe, LEGAL_KIND_LABELS } from '@sd/shared';
import { api, ApiError } from '@/lib/api';
import { areaOf, homePath, useLogout, useMe, type Area, type Me } from '@/lib/session';
import { realtime, useChannel, useRealtimeStatus } from '@/lib/realtime';
import { Button, Checkbox, ErrorAlert, Modal, Spinner } from './ui';
import { ChangePasswordDialog } from './password-dialog';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV: Record<Area, NavItem[]> = {
  admin: [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: '/admin/anfragen', label: 'Aufnahme-Anfragen', icon: Inbox },
    { href: '/admin/disposition', label: 'Disposition', icon: MapIcon },
    { href: '/admin/mitarbeiter', label: 'Mitarbeiter', icon: Users },
    { href: '/admin/fahrzeuge', label: 'Fahrzeuge', icon: Car },
    { href: '/admin/pruefung', label: 'Prüfung', icon: ListChecks },
    { href: '/admin/kataloge', label: 'Kataloge', icon: ClipboardList },
    { href: '/admin/auktionen', label: 'Auktionen', icon: Gavel },
    { href: '/admin/verkaeufe', label: 'Verkäufe', icon: Handshake },
    { href: '/admin/autohaeuser', label: 'Autohäuser', icon: Building2 },
    { href: '/admin/haendler', label: 'Händler', icon: Store },
    { href: '/admin/benutzer', label: 'Benutzer', icon: KeyRound },
    { href: '/admin/dokumente', label: 'Dokumente', icon: FileText },
    { href: '/admin/reklamationen', label: 'Reklamationen', icon: MessageSquare },
    { href: '/admin/statistiken', label: 'Statistiken', icon: BarChart3 },
    { href: '/admin/audit', label: 'Audit-Log', icon: ScrollText },
    { href: '/admin/einstellungen', label: 'Einstellungen', icon: Settings },
  ],
  autohaus: [
    { href: '/autohaus', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: '/autohaus/melden', label: 'Inzahlungnahmen melden', icon: Camera },
    { href: '/autohaus/termine', label: 'Termine', icon: CalendarDays },
    { href: '/autohaus/fahrzeuge', label: 'Meine Fahrzeuge', icon: Car },
    { href: '/autohaus/auktionen', label: 'Aktive Auktionen', icon: Gavel },
    { href: '/autohaus/verkauft', label: 'Verkauft', icon: Handshake },
    { href: '/autohaus/nicht-verkauft', label: 'Nicht verkauft', icon: Archive },
    { href: '/autohaus/dokumente', label: 'Dokumente', icon: FileText },
    { href: '/autohaus/statistiken', label: 'Statistiken', icon: BarChart3 },
    { href: '/autohaus/mitarbeiter', label: 'Mitarbeiter', icon: Users },
    { href: '/autohaus/firma', label: 'Firmendaten', icon: Building2 },
  ],
  haendler: [
    { href: '/haendler', label: 'Auktionen', icon: Gavel, exact: true },
    { href: '/haendler/endet-bald', label: 'Endet bald', icon: Timer },
    { href: '/haendler/neu', label: 'Neu eingestellt', icon: Package },
    { href: '/haendler/favoriten', label: 'Favoriten', icon: Star },
    { href: '/haendler/gebote', label: 'Meine Gebote', icon: History },
    { href: '/haendler/gewonnen', label: 'Gewonnen', icon: CircleCheck },
    { href: '/haendler/kaeufe', label: 'Käufe', icon: Handshake },
    { href: '/haendler/abholung', label: 'Abholung', icon: Truck },
    { href: '/haendler/dokumente', label: 'Dokumente', icon: FileText },
    { href: '/haendler/firma', label: 'Firmendaten', icon: Building2 },
  ],
  aussendienst: [
    { href: '/aussendienst', label: 'Heute', icon: House, exact: true },
    { href: '/aussendienst/termine', label: 'Meine Termine', icon: CalendarDays },
    { href: '/aussendienst/aufnehmen', label: 'Fahrzeug aufnehmen', icon: Camera },
    { href: '/aussendienst/uploads', label: 'Offene Uploads', icon: CloudUpload },
    { href: '/aussendienst/abgeschlossen', label: 'Abgeschlossen', icon: ShieldCheck },
  ],
};

const AREA_TITLE: Record<Area, string> = {
  admin: 'Plattform-Administration',
  autohaus: 'Autohaus',
  haendler: 'Händlerportal',
  aussendienst: 'Außendienst',
};

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Zugangsschutz je Bereich. Die eigentliche Autorisierung erfolgt IMMER serverseitig. */
export function AreaShell({ area, children }: { area: Area; children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (me.data) {
      if (me.data.company && me.data.company.status !== 'APPROVED') router.replace('/registrierung/status');
      else if (areaOf(me.data) !== area) router.replace(homePath(me.data));
    }
  }, [me.data, me.error, area, router, pathname]);

  useEffect(() => {
    if (me.data) realtime.start();
  }, [me.data]);

  if (me.isLoading || !me.data || areaOf(me.data) !== area) {
    return me.error && !(me.error instanceof ApiError && me.error.status === 401) ? (
      <div className="p-6">
        <ErrorAlert error={me.error} />
      </div>
    ) : (
      <Spinner />
    );
  }
  // Händlerbereich: Marktplatz-Layout mit dunkler Kopfleiste (Vorlage des Auftraggebers), übrige Bereiche mit Seitenleiste.
  const Layout = area === 'haendler' ? DealerShellLayout : ShellLayout;
  return (
    <Layout area={area} me={me.data}>
      {children}
      <PendingLegalDialog me={me.data} />
    </Layout>
  );
}

function ShellLayout({ area, me, children }: { area: Area; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const items = NAV[area];
  useEffect(() => setOpen(false), [pathname]);
  const mobileFirst = area === 'aussendienst';

  return (
    <div className="flex min-h-screen">
      {/* Sidebar Desktop */}
      <aside className={clsx('hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white', mobileFirst ? 'lg:flex' : 'md:flex')}>
        <Brand area={area} />
        <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Hauptnavigation">
          {items.map((item) => (
            <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">{me.company?.name ?? AREA_TITLE[area]}</div>
      </aside>

      {/* Drawer Mobil */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between pr-2">
              <Brand area={area} />
              <button className="rounded p-2 text-slate-600" onClick={() => setOpen(false)} aria-label="Menü schließen">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              {items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
              ))}
            </nav>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-5">
          <button className={clsx('rounded p-2 text-slate-700', mobileFirst ? 'lg:hidden' : 'md:hidden')} onClick={() => setOpen(true)} aria-label="Menü öffnen">
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">
            {AREA_TITLE[area]}
            {me.company && <span className="hidden text-slate-400 sm:inline"> · {me.company.name}</span>}
          </div>
          <ConnectionIndicator />
          <NotificationBell me={me} />
          <UserMenu me={me} />
        </header>
        <main className={clsx('flex-1 p-3 sm:p-6', mobileFirst && 'pb-24 lg:pb-6')}>{children}</main>
        {mobileFirst && (
          <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white lg:hidden" aria-label="Schnellnavigation">
            {items.map((item) => {
              const active = isActive(pathname, item);
              return (
                <Link key={item.href} href={item.href} className={clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active ? 'text-brand-700' : 'text-slate-500')} aria-current={active ? 'page' : undefined}>
                  <item.icon className="h-5 w-5" aria-hidden />
                  <span className="truncate px-1">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </div>
  );
}

function Brand({ area }: { area: Area }) {
  return (
    <Link href={`/${area}`} className="flex h-14 items-center gap-2 px-4">
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-700 text-sm font-bold text-white">SD</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">Schnell-Deal</span>
        <span className="block text-[11px] text-slate-500">{AREA_TITLE[area]}</span>
      </span>
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium',
        active ? 'bg-brand-50 text-brand-800' : 'text-slate-700 hover:bg-slate-100',
      )}
    >
      <item.icon className="h-4 w-4 shrink-0" aria-hidden />
      {item.label}
    </Link>
  );
}

function ConnectionIndicator() {
  const status = useRealtimeStatus();
  const online = status === 'online';
  return (
    <span
      className={clsx('hidden items-center gap-1 rounded-full px-2 py-0.5 text-xs sm:inline-flex', online ? 'text-emerald-700' : 'text-amber-700')}
      title={online ? 'Live-Verbindung aktiv' : 'Live-Verbindung wird hergestellt'}
    >
      {online ? <Wifi className="h-3.5 w-3.5" aria-hidden /> : <WifiOff className="h-3.5 w-3.5" aria-hidden />}
      {online ? 'Live' : status === 'connecting' ? 'Verbinde …' : 'Offline'}
    </span>
  );
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

function NotificationBell({ me, dark }: { me: Me; dark?: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: NotificationItem[]; unreadCount: number }>('/notifications'), refetchInterval: 60_000 });
  useChannel(`user:${me.user.id}`, (e) => {
    if (e.event === 'notification' || e.event === 'resync') void qc.invalidateQueries({ queryKey: ['notifications'] });
  });
  const markAll = async () => {
    await api('/notifications/read', { method: 'POST', body: { all: true } });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };
  const unread = q.data?.unreadCount ?? 0;
  return (
    <div className="relative">
      <button className={clsx('relative rounded-full p-2', dark ? 'text-white hover:bg-white/10' : 'text-slate-600 hover:bg-slate-100')} onClick={() => setOpen((v) => !v)} aria-label={`Benachrichtigungen (${unread} ungelesen)`} aria-expanded={open}>
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <span className="text-sm font-semibold">Benachrichtigungen</span>
            {unread > 0 && (
              <button className="text-xs text-brand-700 hover:underline" onClick={markAll}>
                Alle als gelesen markieren
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="p-4 text-sm text-slate-500">Keine Benachrichtigungen.</li>}
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id} className={clsx('border-b border-slate-100 px-3 py-2', !n.readAt && 'bg-brand-50/50')}>
                {n.link ? (
                  <Link href={n.link} onClick={() => setOpen(false)} className="block">
                    <NotificationText n={n} />
                  </Link>
                ) : (
                  <NotificationText n={n} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationText({ n }: { n: NotificationItem }) {
  return (
    <>
      <p className="text-sm font-medium text-slate-900">
        {!n.readAt && <span className="sr-only">Ungelesen: </span>}
        {n.title}
      </p>
      <p className="text-xs text-slate-600">{n.body}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{formatDateTimeDe(n.createdAt)}</p>
    </>
  );
}

function UserMenu({ me }: { me: Me }) {
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  return (
    <div className="relative">
      <button className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-white" onClick={() => setOpen((v) => !v)} aria-label="Benutzermenü" aria-expanded={open}>
        {me.user.firstName.charAt(0)}
        {me.user.lastName.charAt(0)}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-2 py-1.5">
            <p className="text-sm font-medium">
              {me.user.firstName} {me.user.lastName}
            </p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
          </div>
          <button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => (setPw(true), setOpen(false))}>
            Passwort ändern
          </button>
          <PushToggle />
          <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-700 hover:bg-red-50" onClick={logout}>
            <LogOut className="h-4 w-4" /> Abmelden
          </button>
        </div>
      )}
      <ChangePasswordDialog open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

/** Neue Rechtstext-Versionen müssen akzeptiert werden, bevor die Plattform weiter genutzt wird (Spec §60). */
function PendingLegalDialog({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (me.pendingLegal.length === 0) return null;
  const allChecked = me.pendingLegal.every((d) => checked[d.id]);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/auth/accept-legal', { method: 'POST', body: { legalDocumentIds: me.pendingLegal.map((d) => d.id) } });
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={() => undefined}
      title="Aktualisierte Bedingungen"
      footer={
        <Button onClick={accept} disabled={!allChecked} loading={busy}>
          Zustimmen und fortfahren
        </Button>
      }
    >
      <p className="mb-3 text-sm text-slate-600">Folgende Rechtstexte wurden aktualisiert. Bitte lesen und bestätigen Sie die aktuelle Fassung.</p>
      <div className="space-y-3">
        {me.pendingLegal.map((d) => (
          <Checkbox
            key={d.id}
            checked={!!checked[d.id]}
            onChange={(v) => setChecked((c) => ({ ...c, [d.id]: v }))}
            label={
              <>
                Ich akzeptiere: <a className="text-brand-700 underline" href={`/rechtliches/${d.kind}`} target="_blank" rel="noreferrer">{d.title}</a> (Version {d.version})
              </>
            }
            description={LEGAL_KIND_LABELS[d.kind]}
          />
        ))}
      </div>
      <ErrorAlert error={error} className="mt-3" />
    </Modal>
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Web-Push aktivieren (nur wenn Server-VAPID-Schlüssel konfiguriert und Service Worker aktiv). */
function PushToggle() {
  const key = useQuery({ queryKey: ['push-key'], queryFn: () => api<{ publicKey: string | null }>('/notifications/push-key'), staleTime: Infinity });
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const supported = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  if (!supported || !key.data?.publicKey) return null;
  const enable = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key.data!.publicKey!) as BufferSource });
      await api('/notifications/push-subscribe', { method: 'POST', body: sub.toJSON() });
      setState('done');
    } catch {
      setState('error');
    }
  };
  return (
    <button className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={enable} disabled={state === 'done'}>
      {state === 'done' ? 'Push-Benachrichtigungen aktiv' : state === 'error' ? 'Push nicht möglich (Berechtigung?)' : 'Push-Benachrichtigungen aktivieren'}
    </button>
  );
}

// ---------------------------------------------------------------- Händlerbereich (Marktplatz-Layout nach Vorlage)

const DEALER_MENU: { title: string; items: NavItem[] }[] = [
  { title: 'Auktionen', items: NAV.haendler.slice(0, 4) },
  { title: 'Mein Bereich', items: NAV.haendler.slice(4) },
];

/** Schließt ein Menü bei Klick außerhalb oder Escape. */
function useDismiss(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

/** Dunkle Kopfleiste: Logo, Fahrzeugsuche, Benachrichtigungen, Favoriten, Sprache und Benutzermenü mit allen Händlerseiten. */
function DealerShellLayout({ me, children }: { area: Area; me: Me; children: ReactNode }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  return (
    <div className="min-h-screen bg-[#f3f5f8]">
      <header className="sticky top-0 z-30 bg-[#0f1b2d] text-white shadow-md">
        <div className="mx-auto flex h-[54px] max-w-[1600px] items-center gap-3 px-3 sm:px-[18px]">
          <Link href="/haendler" className="flex shrink-0 items-center gap-2.5" aria-label="Schnell-Deal – zur Auktionsübersicht">
            <span className="flex h-8 w-11 -skew-x-12 items-center justify-center rounded-sm bg-red-600" aria-hidden>
              <Gavel className="h-5 w-5 skew-x-12 text-white" />
            </span>
            <span className="text-lg font-extrabold uppercase tracking-wide sm:text-[22px]">Schnell-Deal</span>
          </Link>
          <form
            role="search"
            className="ml-4 hidden w-full max-w-[400px] md:block lg:ml-16"
            onSubmit={(e) => {
              e.preventDefault();
              const term = q.trim();
              router.push(term ? `/haendler?q=${encodeURIComponent(term)}` : '/haendler');
            }}
          >
            <label className="relative block">
              <span className="sr-only">Fahrzeuge suchen</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" aria-hidden />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Fahrzeuge, Marke, Modell, ..."
                className="h-[34px] w-full rounded-md border border-white/10 bg-[#2a3445] pl-9 pr-3 text-sm text-white placeholder:text-slate-300 focus:border-white/30 focus:outline-none"
              />
            </label>
          </form>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <Link href="/haendler" className="rounded-full p-2 hover:bg-white/10 md:hidden" aria-label="Fahrzeuge suchen">
              <Search className="h-5 w-5" aria-hidden />
            </Link>
            <OfflineHint />
            <NotificationBell me={me} dark />
            <Link href="/haendler/favoriten" className="hidden items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/10 sm:inline-flex">
              <Heart className="h-5 w-5" aria-hidden /> Favoriten
            </Link>
            <LanguageMenu />
            <DealerUserMenu me={me} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-3 py-3 sm:px-[18px]">{children}</main>
    </div>
  );
}

/** Live-Verbindung: nur bei Problemen sichtbar (kurze Verbindungsaufbauten erzeugen keinen Hinweis). */
function OfflineHint() {
  const status = useRealtimeStatus();
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDelayed(status !== 'online'), status === 'online' ? 0 : 1500);
    return () => clearTimeout(t);
  }, [status]);
  if (status === 'online' || !delayed) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs text-amber-100" title="Live-Verbindung wird hergestellt">
      <WifiOff className="h-3.5 w-3.5" aria-hidden />
      {status === 'connecting' ? 'Verbinde …' : 'Offline'}
    </span>
  );
}

function GermanFlag() {
  return (
    <span className="flex h-3.5 w-[22px] flex-col overflow-hidden rounded-[2px]" aria-hidden>
      <span className="flex-1 bg-black" />
      <span className="flex-1 bg-[#dd0000]" />
      <span className="flex-1 bg-[#ffce00]" />
    </span>
  );
}

/** Oberflächensprache. Die Plattform ist derzeit ausschließlich deutschsprachig. */
function LanguageMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="relative hidden sm:block" ref={ref}>
      <button className="flex items-center gap-1.5 rounded-md px-2 py-2 hover:bg-white/10" onClick={() => setOpen((v) => !v)} aria-label="Sprache: Deutsch" aria-expanded={open} aria-haspopup="menu">
        <GermanFlag />
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-44 rounded-lg border border-slate-200 bg-white p-1 text-slate-800 shadow-xl">
          <button role="menuitemradio" aria-checked="true" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => setOpen(false)}>
            <GermanFlag /> Deutsch
            <Check className="ml-auto h-4 w-4 text-emerald-600" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

function DealerUserMenu({ me }: { me: Me }) {
  const logout = useLogout();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const name = me.company?.name ?? `${me.user.firstName} ${me.user.lastName}`;
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/10" onClick={() => setOpen((v) => !v)} aria-label="Benutzermenü" aria-expanded={open} aria-haspopup="menu">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-400/40" aria-hidden>
          <UserRound className="h-5 w-5 text-white" />
        </span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block max-w-[12rem] truncate text-sm font-semibold">{name}</span>
          <span className="block text-xs text-slate-300">Händler</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 lg:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-72 rounded-lg border border-slate-200 bg-white p-2 text-slate-800 shadow-xl">
          <div className="border-b border-slate-100 px-2 pb-2">
            <p className="text-sm font-semibold">
              {me.user.firstName} {me.user.lastName}
            </p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
          </div>
          {DEALER_MENU.map((group) => (
            <div key={group.title} className="border-b border-slate-100 py-1">
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{group.title}</p>
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={clsx('flex items-center gap-2.5 rounded px-2 py-1.5 text-sm', active ? 'bg-red-50 font-medium text-red-700' : 'hover:bg-slate-100')}
                  >
                    <item.icon className="h-4 w-4" aria-hidden /> {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="pt-1">
            <button role="menuitem" className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => (setPw(true), setOpen(false))}>
              Passwort ändern
            </button>
            <PushToggle />
            <button role="menuitem" className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-red-700 hover:bg-red-50" onClick={logout}>
              <LogOut className="h-4 w-4" /> Abmelden
            </button>
          </div>
        </div>
      )}
      <ChangePasswordDialog open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
