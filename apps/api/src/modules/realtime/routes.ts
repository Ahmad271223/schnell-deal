import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { and, eq, sql } from 'drizzle-orm';
import { allowedOrigins } from '../../config';
import { db, schema } from '../../core/db/client';
import { isAdmin, resolveSession, SESSION_COOKIE, type AuthUser } from '../../core/auth';
import { channels, hub } from '../../core/realtime';
import { dealerAuctionVisibility } from '../auctions/access';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Darf der Benutzer den Kanal abonnieren? Gleiche Regeln wie die REST-Endpunkte. */
async function canSubscribe(user: AuthUser, channel: string): Promise<boolean> {
  if (channel === channels.user(user.userId)) return true;
  if (channel === channels.admin()) return isAdmin(user);
  const m = /^auction:(.+)$/.exec(channel);
  if (!m || !UUID_RE.test(m[1]!)) return false;
  const auctionId = m[1]!;
  if (isAdmin(user)) return true;
  if (user.company?.type === 'DEALER') {
    const [a] = await db.select({ id: schema.auctions.id }).from(schema.auctions).where(and(eq(schema.auctions.id, auctionId), dealerAuctionVisibility(user)));
    return !!a;
  }
  if (user.company?.type === 'DEALERSHIP' && user.company.status === 'APPROVED') {
    const [a] = await db
      .select({ id: schema.auctions.id })
      .from(schema.auctions)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, schema.auctions.vehicleId))
      .where(and(eq(schema.auctions.id, auctionId), eq(schema.vehicles.companyId, user.company.id), sql`${schema.auctions.status} <> 'DRAFT'`));
    return !!a;
  }
  return false;
}

/**
 * WebSocket /api/v1/ws
 * - Authentifizierung über das Session-Cookie beim Handshake, Origin-Prüfung gegen Cross-Site-WebSocket-Hijacking.
 * - Clients senden: {type:'subscribe'|'unsubscribe', channel} und {type:'ping'}.
 * - Server sendet Ereignisse inkl. serverNow (Zeitabgleich für Countdowns).
 * - Gebote werden NICHT über den Socket angenommen, sondern ausschließlich per HTTP (Rate-Limit, Idempotenz).
 */
export async function realtimeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, async (socket: WebSocket, req) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) {
      socket.close(4003, 'origin_not_allowed');
      return;
    }
    const token = req.cookies[SESSION_COOKIE];
    const user = token ? await resolveSession(token) : null;
    if (!user) {
      socket.close(4001, 'unauthenticated');
      return;
    }
    hub.subscribe(socket, channels.user(user.userId));
    socket.send(JSON.stringify({ type: 'hello', serverNow: new Date().toISOString(), userId: user.userId }));

    let subscriptions = 0;
    socket.on('message', async (raw) => {
      let msg: { type?: string; channel?: string; id?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', serverNow: new Date().toISOString(), id: msg.id }));
        return;
      }
      if ((msg.type === 'subscribe' || msg.type === 'unsubscribe') && typeof msg.channel === 'string' && msg.channel.length < 100) {
        if (msg.type === 'unsubscribe') {
          hub.unsubscribe(socket, msg.channel);
          return;
        }
        if (subscriptions >= 200) {
          socket.send(JSON.stringify({ type: 'error', channel: msg.channel, code: 'TOO_MANY_SUBSCRIPTIONS' }));
          return;
        }
        // Session bei jeder Subscription erneut prüfen (Sperrung während der Verbindung).
        const fresh = await resolveSession(token!);
        if (!fresh) {
          socket.close(4001, 'session_revoked');
          return;
        }
        if (await canSubscribe(fresh, msg.channel)) {
          hub.subscribe(socket, msg.channel);
          subscriptions++;
          socket.send(JSON.stringify({ type: 'subscribed', channel: msg.channel, serverNow: new Date().toISOString() }));
        } else {
          socket.send(JSON.stringify({ type: 'error', channel: msg.channel, code: 'FORBIDDEN' }));
        }
      }
    });
    socket.on('close', () => hub.remove(socket));
    socket.on('error', () => hub.remove(socket));
  });
}
