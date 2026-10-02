import pg from 'pg';
import { sql } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { config } from '../config';
import type { DbOrTx } from './db/client';

/**
 * Realtime-Bus über Postgres LISTEN/NOTIFY.
 *
 * - `publish` wird INNERHALB der fachlichen Transaktion aufgerufen. Postgres stellt NOTIFY erst
 *   beim COMMIT zu → Clients sehen nie einen Zustand, der zurückgerollt wurde.
 * - Jede API-Instanz lauscht auf dem Kanal und verteilt an ihre lokal verbundenen WebSockets.
 *   Dadurch funktioniert Realtime auch mit mehreren Instanzen hinter einem Load Balancer.
 */

const PG_CHANNEL = 'sd_realtime';

export interface RealtimeMessage {
  c: string; // Kanal, z. B. auction:<id>, user:<id>, admin
  e: string; // Ereignis
  d: unknown; // Nutzdaten (klein halten, < 7 kB)
}

export async function publish(tx: DbOrTx, channel: string, event: string, data: unknown): Promise<void> {
  const payload = JSON.stringify({ c: channel, e: event, d: data } satisfies RealtimeMessage);
  if (payload.length > 7500) throw new Error(`Realtime-Payload zu groß (${payload.length} Bytes) für ${channel}/${event}`);
  await tx.execute(sql`select pg_notify(${PG_CHANNEL}, ${payload})`);
}

type Listener = (msg: RealtimeMessage) => void;

class Hub {
  private channels = new Map<string, Set<WebSocket>>();
  private socketChannels = new Map<WebSocket, Set<string>>();
  private listeners = new Set<Listener>();
  private client: pg.Client | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: config.DATABASE_URL });
    client.on('notification', (n) => {
      if (n.channel !== PG_CHANNEL || !n.payload) return;
      try {
        this.dispatch(JSON.parse(n.payload) as RealtimeMessage);
      } catch (err) {
        console.error('[realtime] Ungültige Nachricht', err);
      }
    });
    client.on('error', (err) => {
      console.error('[realtime] LISTEN-Verbindung verloren, verbinde neu …', err.message);
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());
    await client.connect();
    await client.query(`LISTEN ${PG_CHANNEL}`);
    this.client = client;
    // Nach einem Reconnect können Ereignisse verpasst worden sein → Clients zum Resync auffordern.
    this.broadcastAll('resync', {});
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.client = null;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch (err) {
        console.error('[realtime] Reconnect fehlgeschlagen', (err as Error).message);
        this.scheduleReconnect();
      }
    }, 2000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const c = this.client;
    this.client = null;
    if (c) await c.end().catch(() => undefined);
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribe(ws: WebSocket, channel: string): void {
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(ws);
    let chs = this.socketChannels.get(ws);
    if (!chs) this.socketChannels.set(ws, (chs = new Set()));
    chs.add(channel);
  }

  unsubscribe(ws: WebSocket, channel: string): void {
    this.channels.get(channel)?.delete(ws);
    this.socketChannels.get(ws)?.delete(channel);
  }

  remove(ws: WebSocket): void {
    for (const ch of this.socketChannels.get(ws) ?? []) this.channels.get(ch)?.delete(ws);
    this.socketChannels.delete(ws);
  }

  /** Alle Sockets eines Kanals schließen (z. B. alle Verbindungen eines gesperrten Benutzers). */
  disconnectChannel(channel: string, reason: string): void {
    for (const ws of this.channels.get(channel) ?? []) {
      try {
        ws.close(4001, reason);
      } catch {
        /* ignore */
      }
    }
  }

  connectionCount(): number {
    return this.socketChannels.size;
  }

  private dispatch(msg: RealtimeMessage): void {
    for (const l of this.listeners) l(msg);
    if (msg.e === '__disconnect') {
      this.disconnectChannel(msg.c, 'session_revoked');
      return;
    }
    const set = this.channels.get(msg.c);
    if (!set) return;
    const frame = JSON.stringify({ type: 'event', channel: msg.c, event: msg.e, data: msg.d, serverNow: new Date().toISOString() });
    for (const ws of set) {
      if (ws.readyState === 1) ws.send(frame);
    }
  }

  private broadcastAll(event: string, data: unknown): void {
    const frame = JSON.stringify({ type: 'event', channel: '*', event, data, serverNow: new Date().toISOString() });
    for (const ws of this.socketChannels.keys()) if (ws.readyState === 1) ws.send(frame);
  }
}

export const hub = new Hub();

export const channels = {
  auction: (id: string) => `auction:${id}`,
  user: (id: string) => `user:${id}`,
  admin: () => 'admin',
};
