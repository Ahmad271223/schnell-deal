'use client';

import clsx from 'clsx';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Info,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import type { Tone } from '@sd/shared';
import { errorMessage } from '@/lib/api';

// ---------------------------------------------------------------- Buttons
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-600/50',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all active:scale-[0.99] disabled:cursor-not-allowed',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        size === 'xl' && 'h-16 px-6 text-lg',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = 'primary', size = 'md', className, children, icon, testId }: { href: string; variant?: Variant; size?: ButtonProps['size']; className?: string; children: ReactNode; icon?: ReactNode; testId?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-5 text-base',
        size === 'xl' && 'h-16 px-6 text-lg',
        variants[variant],
        className,
      )}
    >
      {icon}
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------- Formulare
export function Field({ label, error, hint, required, children, htmlFor, className }: { label: string; error?: string; hint?: string; required?: boolean; children: ReactNode; htmlFor?: string; className?: string }) {
  const auto = useId();
  // Label automatisch mit dem Eingabefeld verknüpfen (Barrierefreiheit, Testbarkeit).
  const child = isValidElement<{ id?: string; 'aria-describedby'?: string; 'aria-required'?: boolean }>(children) ? children : null;
  const id = htmlFor ?? child?.props.id ?? `f${auto}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  // Nur Eingabe-Komponenten erhalten die ID (Wrapper-Elemente wie <div> bleiben unverändert).
  const cloneable = !!child && (typeof child.type !== 'string' || ['input', 'select', 'textarea'].includes(child.type));
  const content = cloneable ? cloneElement(child!, { id, 'aria-describedby': describedBy, ...(required ? { 'aria-required': true } : {}) }) : children;
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-600" aria-hidden> *</span>}
      </label>
      {content}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="flex items-center gap-1 text-xs text-red-700" role="alert">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> {error}
        </p>
      )}
    </div>
  );
}

const inputCls = 'h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input({ className, invalid, ...rest }, ref) {
  return <input ref={ref} className={clsx(inputCls, invalid && 'border-red-500', className)} aria-invalid={invalid || undefined} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea({ className, invalid, ...rest }, ref) {
  return <textarea ref={ref} className={clsx(inputCls, 'h-auto min-h-[80px] py-2', invalid && 'border-red-500', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select ref={ref} className={clsx(inputCls, 'pr-8', invalid && 'border-red-500', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, checked, onChange, id, disabled, description }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string; disabled?: boolean; description?: string }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <div className="flex items-start gap-2">
      <input id={cid} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={cid} className="text-sm text-slate-700">
        {label}
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </label>
    </div>
  );
}

/** Ja/Nein-Auswahl als Segmentschalter (große Touch-Ziele). */
export function YesNo({ value, onChange, label }: { value: boolean | null; onChange: (v: boolean) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm font-medium text-slate-700">{label}</legend>
      <div className="inline-flex overflow-hidden rounded-md border border-slate-300">
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
            className={clsx('h-10 min-w-20 px-4 text-sm font-medium', value === v ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}
          >
            {v ? 'Ja' : 'Nein'}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- Status
const toneCls: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-300',
  info: 'bg-sky-50 text-sky-800 ring-sky-300',
  progress: 'bg-indigo-50 text-indigo-800 ring-indigo-300',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  warning: 'bg-amber-50 text-amber-900 ring-amber-300',
  danger: 'bg-red-50 text-red-800 ring-red-300',
};
const toneIcon: Record<Tone, typeof Circle> = {
  neutral: Circle,
  info: Info,
  progress: Clock,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/** Status immer mit Text UND Symbol – nie nur über Farbe (Spec §54). */
export function StatusBadge({ label, tone, className }: { label: string; tone: Tone; className?: string }) {
  const Icon = toneIcon[tone];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', toneCls[tone], className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {label}
    </span>
  );
}

export function statusBadge<T extends string>(map: Record<T, [string, Tone]>, value: T | null | undefined) {
  if (!value) return <span className="text-slate-400">–</span>;
  const [label, tone] = map[value] ?? [value, 'neutral' as Tone];
  return <StatusBadge label={label} tone={tone} />;
}

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const Icon = toneIcon[tone];
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-md p-3 text-sm ring-1 ring-inset', toneCls[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <Alert tone="danger" className={className} title="Aktion fehlgeschlagen">
      {errorMessage(error)}
    </Alert>
  );
}

// ---------------------------------------------------------------- Layout
export function Card({ title, actions, children, className, padded = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={clsx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx(padded && 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {back && (
          <Link href={back} className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <ChevronLeft className="h-4 w-4" aria-hidden /> Zurück
          </Link>
        )}
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({ label, value, hint, icon, emphasis }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; emphasis?: boolean }) {
  return (
    <div className={clsx('rounded-xl border bg-white p-4 shadow-sm', emphasis ? 'border-brand-200' : 'border-slate-200')}>
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {icon}
      </div>
      <div className="tabular mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Spinner({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-6 text-sm text-slate-500" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      {icon && <div className="text-slate-400">{icon}</div>}
      <p className="font-medium text-slate-800">{title}</p>
      {children && <div className="text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function QueryState({ query, children, empty }: { query: { isLoading: boolean; error: unknown; data?: unknown }; children: ReactNode; empty?: ReactNode }) {
  if (query.isLoading) return <Spinner />;
  // Nachlade-Fehler (z. B. Funkloch) verdecken vorhandene Daten nicht: Inhalt bleibt stehen, Hinweis darüber.
  if (query.error && query.data === undefined) return <ErrorAlert error={query.error} />;
  if (empty && Array.isArray(query.data) && query.data.length === 0) return <>{empty}</>;
  return (
    <>
      {query.error ? (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
          Aktualisierung fehlgeschlagen ({errorMessage(query.error)}). Angezeigt wird der zuletzt geladene Stand.
        </p>
      ) : null}
      {children}
    </>
  );
}

// ---------------------------------------------------------------- Tabelle
export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto rounded-lg border border-slate-200 bg-white', className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={clsx('whitespace-nowrap px-3 py-2 align-middle text-slate-800', className)}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------- Tabs
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
            value === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:text-slate-900',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- Dialog
/**
 * Rendert Überlagerungen (Dialoge, Vollbild) direkt unter <body>. Sonst bleiben sie im Stacking-Kontext ihres
 * Elternteils gefangen (z. B. einer klebenden Seitenspalte) und werden von später gezeichneten Elementen überdeckt.
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}

export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; size?: 'md' | 'lg' | 'xl' }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <Portal>
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white shadow-xl sm:rounded-xl', size === 'md' && 'sm:max-w-lg', size === 'lg' && 'sm:max-w-2xl', size === 'xl' && 'sm:max-w-5xl')}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Schließen">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div>}
      </div>
    </div>
    </Portal>
  );
}

export function DescriptionList({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx('grid gap-x-6 gap-y-3', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v ?? '–'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pagination({ page, hasMore, onChange }: { page: number; hasMore: boolean; onChange: (p: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-end gap-2">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
        Zurück
      </Button>
      <span className="text-sm text-slate-600">Seite {page}</span>
      <Button variant="secondary" size="sm" disabled={!hasMore} onClick={() => onChange(page + 1)}>
        Weiter <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
