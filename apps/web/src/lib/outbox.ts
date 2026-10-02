'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { idbAll, idbDelete, idbGet, idbPut, requestPersistence } from './idb';

/**
 * Offline-Warteschlange der Fahrzeugaufnahme (Spec §50/§51).
 *
 * - Jede Änderung (JSON oder Datei) wird zuerst lokal in IndexedDB gespeichert.
 * - Ein Prozessor arbeitet die Warteschlange strikt in Reihenfolge ab, sobald eine Verbindung besteht.
 * - Die Item-ID dient als clientUploadId/clientVehicleId → Wiederholungen nach Abbrüchen sind serverseitig idempotent.
 * - Netzwerkfehler/5xx: automatischer erneuter Versuch mit Backoff. Fachliche Fehler (4xx): sichtbar markiert,
 *   der Mitarbeiter kann erneut versuchen oder verwerfen. Nichts geht still verloren.
 */

export interface OutboxItem {
  id: string;
  vehicleId: string;
  requestId?: string;
  kind: 'json' | 'file';
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  file?: Blob;
  fileName?: string;
  fields?: Record<string, string>;
  label: string;
  status: 'pending' | 'error';
  attempts: number;
  lastError?: string;
  createdAt: number;
}

interface Stats {
  key: 'stats';
  filesDone: number;
  filesTotal: number;
}

type Snapshot = { items: OutboxItem[]; stats: Stats; online: boolean; processing: boolean };
type Listener = () => void;
type DoneListener = (item: OutboxItem, response: unknown) => void;

class Outbox {
  private snapshot: Snapshot = { items: [], stats: { key: 'stats', filesDone: 0, filesTotal: 0 }, online: true, processing: false };
  private listeners = new Set<Listener>();
  private doneListeners = new Set<DoneListener>();
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 0;

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.snapshot = { ...this.snapshot, online: navigator.onLine };
    window.addEventListener('online', () => {
      this.set({ online: true });
      this.backoff = 0;
      void this.process();
    });
    window.addEventListener('offline', () => this.set({ online: false }));
    void requestPersistence();
    void this.reload().then(() => this.process());
    setInterval(() => void this.process(), 15_000);
  }

  private set(p: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...p };
    this.listeners.forEach((l) => l());
  }

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;
  onDone(l: DoneListener): () => void {
    this.doneListeners.add(l);
    return () => {
      this.doneListeners.delete(l);
    };
  }

  private async reload() {
    const items = (await idbAll<OutboxItem>('outbox')).sort((a, b) => a.createdAt - b.createdAt);
    const stats = (await idbGet<Stats>('meta', 'stats')) ?? { key: 'stats', filesDone: 0, filesTotal: 0 };
    this.set({ items, stats });
  }

  async enqueue(item: Omit<OutboxItem, 'status' | 'attempts' | 'createdAt'> & { createdAt?: number }) {
    const full: OutboxItem = { ...item, status: 'pending', attempts: 0, createdAt: item.createdAt ?? Date.now() };
    await idbPut('outbox', full);
    if (full.kind === 'file') {
      const stats = { ...this.snapshot.stats, filesTotal: this.snapshot.stats.filesTotal + 1 };
      await idbPut('meta', stats);
    }
    await this.reload();
    void this.process();
    return full;
  }

  async retry(id: string) {
    const item = this.snapshot.items.find((i) => i.id === id);
    if (!item) return;
    await idbPut('outbox', { ...item, status: 'pending', lastError: undefined });
    await this.reload();
    this.backoff = 0;
    void this.process();
  }

  async discard(id: string) {
    const item = this.snapshot.items.find((i) => i.id === id);
    await idbDelete('outbox', id);
    if (item?.kind === 'file') {
      const stats = { ...this.snapshot.stats, filesTotal: Math.max(this.snapshot.stats.filesDone, this.snapshot.stats.filesTotal - 1) };
      await idbPut('meta', stats);
    }
    await this.reload();
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.process(), ms);
  }

  async process(): Promise<void> {
    if (this.snapshot.processing || !this.started) return;
    if (!navigator.onLine) {
      this.set({ online: false });
      return;
    }
    this.set({ processing: true });
    try {
      for (;;) {
        await this.reload();
        const next = this.snapshot.items.find((i) => i.status === 'pending');
        if (!next) break;
        const result = await this.send(next);
        if (result === 'retry') {
          this.backoff = Math.min(6, this.backoff + 1);
          this.schedule(2000 * 2 ** this.backoff);
          break;
        }
        this.backoff = 0;
      }
      if (this.snapshot.items.length === 0 && this.snapshot.stats.filesTotal > 0) {
        await idbPut('meta', { key: 'stats', filesDone: 0, filesTotal: 0 });
        await this.reload();
      }
    } finally {
      this.set({ processing: false });
    }
  }

  private async send(item: OutboxItem): Promise<'ok' | 'retry' | 'error'> {
    let res: Response;
    try {
      let body: BodyInit | undefined;
      const headers: Record<string, string> = {};
      if (item.kind === 'file' && item.file) {
        const fd = new FormData();
        for (const [k, v] of Object.entries(item.fields ?? {})) fd.append(k, v);
        fd.append('file', item.file, item.fileName ?? 'upload.jpg');
        body = fd;
      } else if (item.body !== undefined) {
        body = JSON.stringify(item.body);
        headers['content-type'] = 'application/json';
      }
      res = await fetch(`/api/v1${item.url}`, { method: item.method, body, headers, credentials: 'same-origin' });
    } catch {
      this.set({ online: navigator.onLine });
      await idbPut('outbox', { ...item, attempts: item.attempts + 1, lastError: 'Keine Verbindung – wird automatisch erneut versucht' });
      return 'retry';
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (res.ok) {
      await idbDelete('outbox', item.id);
      if (item.kind === 'file') {
        const stats = await idbGet<Stats>('meta', 'stats');
        await idbPut('meta', { key: 'stats', filesDone: (stats?.filesDone ?? 0) + 1, filesTotal: Math.max(stats?.filesTotal ?? 0, (stats?.filesDone ?? 0) + 1) });
      }
      this.doneListeners.forEach((l) => l(item, data));
      return 'ok';
    }
    const message = (data as { error?: { message?: string } } | null)?.error?.message ?? `Fehler ${res.status}`;
    if (res.status >= 500 || res.status === 429 || res.status === 401) {
      await idbPut('outbox', { ...item, attempts: item.attempts + 1, lastError: res.status === 401 ? 'Bitte erneut anmelden – Daten bleiben gespeichert' : message });
      return 'retry';
    }
    await idbPut('outbox', { ...item, status: 'error', attempts: item.attempts + 1, lastError: message });
    this.doneListeners.forEach((l) => l({ ...item, status: 'error', lastError: message }, data));
    return 'error';
  }
}

export const outbox = new Outbox();

export function useOutbox() {
  useEffect(() => outbox.start(), []);
  return useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getSnapshot);
}

/** Lokale Entwürfe (Formularstände) je Fahrzeug und Schritt – überleben Neuladen und Funklöcher. */
export async function saveDraft<T>(key: string, value: T): Promise<void> {
  await idbPut('drafts', { key, value, savedAt: Date.now() });
}

export async function loadDraft<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<{ key: string; value: T }>('drafts', key);
  return row?.value;
}

export function useDraft<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void loadDraft<T>(key).then((d) => {
      if (!alive) return;
      if (d !== undefined) setValue(d);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [key]);
  const update = (v: T | ((old: T) => T)) => {
    setValue((old) => {
      const next = typeof v === 'function' ? (v as (o: T) => T)(old) : v;
      void saveDraft(key, next);
      return next;
    });
  };
  return [value, update, loaded];
}
