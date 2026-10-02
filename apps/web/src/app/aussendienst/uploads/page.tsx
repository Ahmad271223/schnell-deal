'use client';

import { CloudUpload, RefreshCw, Trash2, WifiOff } from 'lucide-react';
import { formatDateTimeDe } from '@sd/shared';
import { outbox, useOutbox } from '@/lib/outbox';
import { Alert, Button, EmptyState, PageHeader, StatusBadge } from '@/components/ui';

export default function UploadsPage() {
  const { items, stats, online, processing } = useOutbox();
  const files = items.filter((i) => i.kind === 'file');
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Offene Uploads" subtitle="Daten werden bei Verbindung automatisch übertragen – auch nach einem Neustart der App." />
      {!online && (
        <Alert tone="warning" className="mb-3" title="Keine Verbindung">
          <span className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> Alle Fotos und Eingaben sind lokal gesichert und werden später hochgeladen.</span>
        </Alert>
      )}
      <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-slate-600"><CloudUpload className={processing ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} /> Bilder</span>
          <span className="tabular text-xl font-semibold">{stats.filesDone}/{stats.filesTotal} hochgeladen</span>
        </div>
        {stats.filesTotal > 0 && (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-sky-500" style={{ width: `${(stats.filesDone / stats.filesTotal) * 100}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">{items.length} Element(e) in der Warteschlange, davon {files.length} Datei(en).</p>
        <Button size="sm" variant="secondary" className="mt-3" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void outbox.process()} disabled={!online || processing}>
          Jetzt synchronisieren
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="Alles übertragen" icon={<CloudUpload className="h-8 w-8" />} />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{i.label}</p>
                <p className="text-xs text-slate-500">{formatDateTimeDe(new Date(i.createdAt))} · Versuche: {i.attempts}</p>
                {i.lastError && <p className={i.status === 'error' ? 'text-xs text-red-700' : 'text-xs text-amber-700'}>{i.lastError}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {i.status === 'error' ? <StatusBadge label="Fehler" tone="danger" /> : <StatusBadge label="Wartet" tone="progress" />}
                {i.status === 'error' && (
                  <>
                    <button className="rounded p-2 text-slate-600" onClick={() => void outbox.retry(i.id)} aria-label="Erneut versuchen"><RefreshCw className="h-4 w-4" /></button>
                    <button className="rounded p-2 text-red-600" onClick={() => confirm('Dieses Element wirklich verwerfen?') && void outbox.discard(i.id)} aria-label="Verwerfen"><Trash2 className="h-4 w-4" /></button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
