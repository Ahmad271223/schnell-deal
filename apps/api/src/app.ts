import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { InvalidTransitionError } from '@sd/shared';
import { allowedOrigins, config, rateMax } from './config';
import { AppError, validationError } from './core/errors';
import { resolveSession, SESSION_COOKIE } from './core/auth';
import { registerRoutes } from './routes';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
            transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
          },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorateRequest('auth', null);

  await app.register(helmet, {
    contentSecurityPolicy: false, // API liefert kein HTML
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler', // nach der Session-Auflösung → Limits pro Benutzer möglich
    max: rateMax(600),
    timeWindow: '1 minute',
    keyGenerator: (req) => req.auth?.userId ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: { code: 'RATE_LIMITED', message: `Zu viele Anfragen. Bitte in ${Math.ceil(ctx.ttl / 1000)} s erneut versuchen.` },
    }),
  });
  await app.register(multipart, {
    limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
  });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  // CSRF-Schutz: mutierende Requests nur von erlaubten Origins (zusätzlich SameSite=Lax-Cookie).
  app.addHook('onRequest', async (req) => {
    if (!MUTATING.has(req.method)) return;
    const origin = req.headers.origin;
    if (origin) {
      if (!allowedOrigins.includes(origin)) throw new AppError(403, 'BAD_ORIGIN', 'Anfrage von unzulässiger Herkunft.');
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'BAD_ORIGIN', 'Anfrage von unzulässiger Herkunft.');
    }
  });

  // Session bei jedem Request serverseitig auflösen.
  app.addHook('onRequest', async (req) => {
    const token = req.cookies[SESSION_COOKIE];
    req.auth = token ? await resolveSession(token) : null;
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Server-Time', new Date().toISOString());
    reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof ZodError) err = validationError(err);
    if (err instanceof InvalidTransitionError) {
      return reply.status(409).send({ error: { code: 'INVALID_TRANSITION', message: err.message } });
    }
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details } });
    }
    // Drizzle verpackt Treiberfehler (DrizzleQueryError); der Postgres-Fehlercode steckt in `cause`.
    const pgCode = (err as { code?: string }).code ?? ((err as { cause?: { code?: string } }).cause?.code);
    if (pgCode === '23505') {
      return reply.status(409).send({ error: { code: 'DUPLICATE', message: 'Eintrag existiert bereits.' } });
    }
    if (pgCode === '23000' || pgCode === '23514' || pgCode === '23503') {
      req.log.warn({ err }, 'Integritätsverletzung');
      return reply.status(409).send({ error: { code: 'INTEGRITY_VIOLATION', message: 'Die Aktion verletzt eine Datenregel.' } });
    }
    const fe = err as FastifyError;
    if (fe.statusCode === 429) {
      return reply.status(429).send(fe);
    }
    if (fe.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.status(413).send({ error: { code: 'FILE_TOO_LARGE', message: `Datei überschreitet ${config.MAX_UPLOAD_MB} MB.` } });
    }
    if (fe.validation || (fe.statusCode && fe.statusCode < 500)) {
      return reply.status(fe.statusCode ?? 400).send({ error: { code: fe.code ?? 'BAD_REQUEST', message: fe.message } });
    }
    req.log.error({ err }, 'Unbehandelter Fehler');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Interner Fehler. Der Vorgang wurde protokolliert.' } });
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route nicht gefunden' } });
  });

  await app.register(registerRoutes, { prefix: '/api/v1' });
  return app;
}
