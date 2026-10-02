'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

export interface RealtimeEvent {
  channel: string;
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  serverNow: string;
}

type Listener = (e: RealtimeEvent) => void;
type Status = 'connecting' | 'online' | 'offline';

/**
 * WebSocket-Client mit automatischem Reconnect und Server-Zeitabgleich.
 * Nach jedem (Re-)Connect werden alle Kanäle neu abonniert und ein "resync" an die
 * Listener gemeldet – Seiten laden daraufhin den aktuellen Zustand per REST nach.
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private status: Status = 'offline';
  private statusListeners = new Set<() => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  /** serverNow - Date.now() in ms */
  offset = 0;

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.connect();
    window.addEventListener('online', () => this.reconnectSoon(0));
  }

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }

  private url(): string {
    const configured = process.env.NEXT_PUBLIC_WS_URL;
    if (configured) return configured;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/api/v1/ws`;
  }

  private setStatus(s: Status) {
    this.status = s;
    this.statusListeners.forEach((l) => l());
  }

  private connect() {
    if (!this.started) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url());
    } catch {
      this.reconnectSoon();
      return;
    }
    this.ws = ws;
    ws.onmessage = (m) => {
      let msg: { type: string; channel?: string; event?: string; data?: unknown; serverNow?: string };
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (msg.serverNow) this.offset = new Date(msg.serverNow).getTime() - Date.now();
      if (msg.type === 'hello') {
        this.retry = 0;
        this.setStatus('online');
        for (const ch of this.listeners.keys()) this.sendSubscribe(ch);
        this.emitAll('resync', {});
      } else if (msg.type === 'event' && msg.event) {
        const evt: RealtimeEvent = { channel: msg.channel ?? '*', event: msg.event, data: msg.data, serverNow: msg.serverNow ?? new Date().toISOString() };
        if (evt.channel === '*') this.emitAll(evt.event, evt.data);
        else this.listeners.get(evt.channel)?.forEach((l) => l(evt));
      }
    };
    ws.onclose = (e) => {
      this.ws = null;
      this.setStatus('offline');
      if (this.pingTimer) clearInterval(this.pingTimer);
      // 4001 = nicht (mehr) angemeldet → kein Reconnect-Sturm.
      this.reconnectSoon(e.code === 4001 ? 30_000 : undefined);
    };
    ws.onerror = () => ws.close();
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);
  }

  private reconnectSoon(delay?: number) {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    const d = delay ?? Math.min(15_000, 500 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
      this.connect();
    }, d);
  }

  private emitAll(event: string, data: unknown) {
    for (const [channel, set] of this.listeners) set.forEach((l) => l({ channel, event, data, serverNow: new Date(Date.now() + this.offset).toISOString() }));
  }

  private sendSubscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', channel }));
  }

  subscribe(channel: string, l: Listener): () => void {
    this.start();
    let set = this.listeners.get(channel);
    if (!set) {
      this.listeners.set(channel, (set = new Set()));
      this.sendSubscribe(channel);
    }
    set.add(l);
    return () => {
      set!.delete(l);
      if (set!.size === 0) {
        this.listeners.delete(channel);
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'unsubscribe', channel }));
      }
    };
  }

  getStatus = () => this.status;
  onStatus = (l: () => void) => {
    this.statusListeners.add(l);
    return () => {
      this.statusListeners.delete(l);
    };
  };

  now(): number {
    return Date.now() + this.offset;
  }

  syncFromServer(serverNow: string | Date | undefined) {
    if (!serverNow) return;
    this.offset = new Date(serverNow).getTime() - Date.now();
  }
}

export const realtime = new RealtimeClient();

export function useChannel(channel: string | null, onEvent: Listener) {
  useEffect(() => {
    if (!channel) return;
    return realtime.subscribe(channel, onEvent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);
}

export function useRealtimeStatus(): Status {
  return useSyncExternalStore(realtime.onStatus, realtime.getStatus, () => 'offline' as Status);
}

/** Server-synchronisierte "Jetzt"-Zeit, aktualisiert im angegebenen Intervall. */
export function useServerNow(intervalMs = 500): number {
  const [now, setNow] = useState(() => realtime.now());
  useEffect(() => {
    const t = setInterval(() => setNow(realtime.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
