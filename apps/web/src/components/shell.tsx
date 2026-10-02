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
  Loader2,
  LogOut,
  Map as MapIcon,
  Menu,
  MessageSquare,
  Package,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Timer,
  Truck,
  Users,
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
    { href: '/autohaus', label: 'Startseite', icon: LayoutDashboard, exact: true },
    { href: '/autohaus/melden', label: 'Inzahlungnahmen melden', icon: Camera },
    { href: '/autohaus/termine', label: 'Termine', icon: CalendarDays },
    { href: '/autohaus/fahrzeuge', label: 'Meine Fahrzeuge', icon: Car },
    { href: '/autohaus/auktionen', label: 'Aktive Auktionen', icon: Gavel },
    { href: '/autohaus/verkauft', label: 'Verkauft', icon: Handshake },
    { href: '/autohaus/nicht-verkauft', label: 'Nicht verkauft', icon: Archive },
    { href: '/autohaus/dokumente', label: 'Dokumente', icon: FileText },
    { href: '/autohaus/statistiken', label: 'Berichte', icon: BarChart3 },
    { href: '/autohaus/mitarbeiter', label: 'Mitarbeiter', icon: Users },
    { href: '/autohaus/firma', label: 'Firmendaten', icon: Building2 },
  ],
  haendler: [
    { href: '/haendler', label: 'Auktionen', icon: Gavel, exact: true },
    { href: '/haendler/endet-bald', label: 'Endet bald', icon: Timer },
    { href: '/haendler/neu', label: 'Neu eingestellt', icon: Package },
    { href: '/haendler/favoriten', label: 'Favoriten', icon: Heart },
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

const AREA_ROLE: Record<Area, string> = {
  admin: 'Administration',
  autohaus: 'Autohaus',
  haendler: 'Händler',
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
  return (
    <ShellLayout area={area} me={me.data}>
      {children}
      <PendingLegalDialog me={me.data} />
    </ShellLayout>
  );
}

// ---------------------------------------------------------------- Einheitliches Layout: dunkle Seitenleiste + helle Kopfzeile

function ShellLayout({ area, me, children }: { area: Area; me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-screen bg-shell">
      {/* Desktop-Seitenleiste (fest) */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-800/80 bg-sidebar lg:flex" data-testid="sidebar">
        <SidebarContent area={area} me={me} pathname={pathname} />
      </aside>

      {/* Mobiler Drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar shadow-2xl">
            <SidebarContent area={area} me={me} pathname={pathname} onClose={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-h-screen flex-col lg:pl-64">
        <Topbar area={area} me={me} onMenu={() => setOpen(true)} />
        <ConnectionBanner />
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Dezenter „Verbinde erneut …“-Hinweis bei WebSocket-Unterbrechungen (kurze Karenz gegen Flackern). */
function ConnectionBanner() {
  const status = useRealtimeStatus();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (status === 'online') {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 2500);
    return () => clearTimeout(t);
  }, [status]);
  if (!show) return null;
  return (
    <div
      className="sticky top-16 z-20 flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-[13px] font-medium text-amber-800"
      role="status"
      aria-live="polite"
      data-testid="connection-banner"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Verbinde erneut … Live-Aktualisierung wird wiederhergestellt.
    </div>
  );
}

function SidebarContent({ area, me, pathname, onClose }: { area: Area; me: Me; pathname: string; onClose?: () => void }) {
  const items = NAV[area];
  return (
    <>
      <div className="flex h-16 items-center justify-between border-b border-slate-800/80 px-5">
        <Logo href={`/${area}`} />
        {onClose && (
          <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={onClose} aria-label="Menü schließen">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>
      <nav className="scroll-slim flex-1 overflow-y-auto px-3 py-4" aria-label="Hauptnavigation" data-testid="sidebar-nav">
        {items.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
        ))}
      </nav>
      <div className="border-t border-slate-800/80 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-bold text-white">
            {me.user.firstName.charAt(0)}
            {me.user.lastName.charAt(0)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{me.company?.name ?? AREA_TITLE[area]}</p>
            <p className="truncate text-xs text-slate-400">{AREA_ROLE[area]}</p>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          <Link href="/rechtliches/IMPRINT" className="hover:text-slate-300">Impressum</Link>
          <span aria-hidden> · </span>
          <Link href="/rechtliches/PRIVACY" className="hover:text-slate-300">Datenschutz</Link>
          <span aria-hidden> · </span>
          <Link href="/rechtliches/TERMS" className="hover:text-slate-300">AGB</Link>
        </p>
      </div>
    </>
  );
}

/** Rotes, angewinkeltes Logo-Emblem + Wortmarke „SCHNELL DEAL“. */
function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2.5" aria-label="Schnell-Deal – Startseite" data-testid="brand-logo">
      <span className="flex h-9 w-10 -skew-x-[14deg] items-center justify-center rounded-[5px] bg-brand-600 shadow-lg shadow-brand-900/40" aria-hidden>
        <Gavel className="h-5 w-5 skew-x-[14deg] text-white" />
      </span>
      <span className="font-display text-[17px] font-extrabold uppercase leading-none tracking-wide">
        <span className="text-white">Schnell</span>
        <span className="text-brand-500"> Deal</span>
      </span>
    </Link>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      data-testid={`nav-${item.href}`}
      className={clsx(
        'mb-1 flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-colors',
        active
          ? 'bg-brand-600 font-semibold text-white shadow-md shadow-brand-900/30'
          : 'font-medium text-slate-400 hover:bg-slate-800/70 hover:text-white',
      )}
    >
      <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

// ---------------------------------------------------------------- Kopfzeile

function Topbar({ area, me, onMenu }: { area: Area; me: Me; onMenu: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const searchTarget = area === 'haendler' ? '/haendler' : area === 'autohaus' ? '/autohaus/fahrzeuge' : area === 'admin' ? '/admin/fahrzeuge' : '/aussendienst';
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6" data-testid="topbar">
      <button className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Menü öffnen">
        <Menu className="h-5 w-5" />
      </button>
      <form
        role="search"
        className="hidden min-w-0 max-w-md flex-1 md:block"
        onSubmit={(e) => {
          e.preventDefault();
          const term = q.trim();
          router.push(term ? `${searchTarget}?q=${encodeURIComponent(term)}` : searchTarget);
        }}
      >
        <label className="relative block">
          <span className="sr-only">Fahrzeuge suchen</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Fahrzeuge, Marke, Modell …"
            data-testid="global-search"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/15"
          />
        </label>
      </form>

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <LiveIndicator />
        {area === 'haendler' && (
          <Link href="/haendler/favoriten" className="relative hidden rounded-lg p-2 text-slate-600 hover:bg-slate-100 sm:inline-flex" aria-label="Favoriten" data-testid="topbar-favorites">
            <Heart className="h-5 w-5" aria-hidden />
          </Link>
        )}
        <NotificationBell me={me} />
        <LanguageMenu />
        <UserMenu area={area} me={me} />
      </div>
    </header>
  );
}

/** Live-Status: grüner Puls wenn verbunden, Hinweis bei Verbindungsproblemen. */
function LiveIndicator() {
  const status = useRealtimeStatus();
  const online = status === 'online';
  return (
    <span
      className={clsx(
        'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold sm:inline-flex',
        online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
      )}
      title={online ? 'Live-Verbindung aktiv' : 'Live-Verbindung wird hergestellt'}
      data-testid="live-indicator"
    >
      <span className={clsx('h-2 w-2 rounded-full', online ? 'bg-emerald-500 live-dot' : 'bg-amber-500')} aria-hidden />
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

function NotificationBell({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
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
    <div className="relative" ref={ref}>
      <button
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Benachrichtigungen (${unread} ungelesen)`}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-bold leading-[18px] text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
            <span className="text-sm font-semibold">Benachrichtigungen</span>
            {unread > 0 && (
              <button className="text-xs font-medium text-brand-700 hover:underline" onClick={markAll}>
                Alle als gelesen markieren
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(q.data?.items ?? []).length === 0 && <li className="p-4 text-sm text-slate-500">Keine Benachrichtigungen.</li>}
            {(q.data?.items ?? []).map((n) => (
              <li key={n.id} className={clsx('border-b border-slate-100 px-4 py-2.5', !n.readAt && 'bg-brand-50/50')}>
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

function GermanFlag() {
  return (
    <span className="flex h-3.5 w-[22px] flex-col overflow-hidden rounded-[2px] ring-1 ring-slate-200" aria-hidden>
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
      <button className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-slate-600 hover:bg-slate-100" onClick={() => setOpen((v) => !v)} aria-label="Sprache: Deutsch" aria-expanded={open} aria-haspopup="menu">
        <GermanFlag />
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1 text-slate-800 shadow-xl">
          <button role="menuitemradio" aria-checked="true" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => setOpen(false)}>
            <GermanFlag /> Deutsch
            <Check className="ml-auto h-4 w-4 text-emerald-600" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

function UserMenu({ area, me }: { area: Area; me: Me }) {
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const name = me.company?.name ?? `${me.user.firstName} ${me.user.lastName}`;
  return (
    <div className="relative" ref={ref}>
      <button className="flex items-center gap-2.5 rounded-lg py-1 pl-1.5 pr-1 hover:bg-slate-100" onClick={() => setOpen((v) => !v)} aria-label="Benutzermenü" aria-expanded={open} aria-haspopup="menu" data-testid="user-menu">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sidebar text-xs font-bold text-white" aria-hidden>
          {me.user.firstName.charAt(0)}
          {me.user.lastName.charAt(0)}
        </span>
        <span className="hidden text-left leading-tight lg:block">
          <span className="block max-w-[12rem] truncate text-sm font-semibold text-slate-900">{name}</span>
          <span className="block text-xs text-slate-500">{AREA_ROLE[area]}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-slate-400 lg:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 text-slate-800 shadow-xl">
          <div className="border-b border-slate-100 px-2 pb-2">
            <p className="text-sm font-semibold">
              {me.user.firstName} {me.user.lastName}
            </p>
            <p className="truncate text-xs text-slate-500">{me.user.email}</p>
          </div>
          <div className="py-1">
            <button role="menuitem" className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => (setPw(true), setOpen(false))}>
              Passwort ändern
            </button>
            <PushToggle />
            <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-brand-700 hover:bg-brand-50" onClick={logout} data-testid="logout-button">
              <LogOut className="h-4 w-4" /> Abmelden
            </button>
          </div>
        </div>
      )}
      <ChangePasswordDialog open={pw} onClose={() => setPw(false)} />
    </div>
  );
}

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
    <button className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={enable} disabled={state === 'done'}>
      {state === 'done' ? 'Push-Benachrichtigungen aktiv' : state === 'error' ? 'Push nicht möglich (Berechtigung?)' : 'Push-Benachrichtigungen aktivieren'}
    </button>
  );
}
